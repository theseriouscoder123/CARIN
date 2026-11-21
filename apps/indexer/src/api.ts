import { packageId as computePackageId } from "@cairn/core";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { Address, Hex } from "viem";
import { z } from "zod";
import type { Ingester } from "./ingest.js";
import { projectPolicy } from "./projection.js";
import type { IndexStore } from "./store.js";
import type { IndexedEvent } from "./types.js";

export interface AttesterHealth {
  label: string;
  address: Address;
  lastProcessedBlock: number;
  processedCount: number;
  divergencesReported: number;
  registryReachable: boolean;
  chainReachable: boolean;
  uptimeSeconds: number;
}

export interface ApiDeps {
  store: IndexStore;
  ingester: Pick<Ingester, "headBlock" | "lastIndexedBlock">;
  /** Live attester /health snapshots; failures are reported as offline, never invented. */
  attesterHealth: () => Promise<{ url: string; health?: AttesterHealth; error?: string }[]>;
  /** Display labels from the deployment file, keyed by lowercase address. */
  attesterLabels?: Record<string, string>;
  corsOrigins: string[];
  lagThreshold: number;
  /** Where this index comes from, so a client can read the same contract itself. */
  chain: { chainId: number; registry: Address };
  log?: (line: string) => void;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed bytes32");
const ListQuery = z.object({
  q: z.string().max(214).optional(),
  status: z.enum(["VERIFIED", "PENDING", "DIVERGENT"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.coerce.number().int().nonnegative().optional()
});
const LookupQuery = z.object({ name: z.string().min(1).max(214), version: z.string().min(1).max(64) });
const FeedQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new HttpError(400, "BAD_REQUEST", r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  return r.data;
}

/** Async route wrapper: every failure becomes a structured error, never a stack trace. */
const route =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

/**
 * Read-only API (SPEC-INDEXER-API §3). There are no write endpoints: nothing can be
 * injected into the record through the indexer.
 */
export function createApi(deps: ApiDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  const log = deps.log ?? (() => {});

  app.use((req, res, next) => {
    const started = Date.now();
    const origin = req.headers.origin;
    if (origin && (deps.corsOrigins.includes("*") || deps.corsOrigins.includes(origin))) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
    }
    res.on("finish", () =>
      log(JSON.stringify({ method: req.method, path: req.originalUrl, status: res.statusCode, ms: Date.now() - started }))
    );
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      res.status(405).json({ error: { code: "READ_ONLY", message: "the CAIRN indexer API is read-only" } });
      return;
    }
    next();
  });

  const asOf = () => deps.ingester.lastIndexedBlock;
  const v1 = express.Router();

  v1.get(
    "/health",
    route(async (_req, res) => {
      const mongo = await deps.store.ping();
      const lag = Math.max(0, deps.ingester.headBlock - deps.ingester.lastIndexedBlock);
      const ok = mongo && lag <= deps.lagThreshold && deps.ingester.lastIndexedBlock >= 0;
      res.status(ok ? 200 : 503).json({
        ok,
        headBlock: deps.ingester.headBlock,
        lastIndexedBlock: deps.ingester.lastIndexedBlock,
        lag,
        store: deps.store.kind,
        chainId: deps.chain.chainId,
        registry: deps.chain.registry,
        mongo: deps.store.kind === "mongo" ? (mongo ? "up" : "down") : "not configured (in-memory store, rebuilt from chain on start)",
        asOfBlock: asOf()
      });
    })
  );

  v1.get(
    "/stats",
    route(async (_req, res) => {
      const [counts, policyEvents] = await Promise.all([
        deps.store.counts(),
        deps.store.eventsOfTypes(["AttesterAdded", "AttesterRemoved", "ThresholdChanged"])
      ]);
      const policy = projectPolicy(policyEvents);
      res.json({
        totalAttestations: counts.total,
        quorumReached: counts.verified,
        pending: counts.pending,
        divergent: counts.divergent,
        activeAttesters: policy.attesters.length,
        threshold: policy.threshold,
        headBlock: deps.ingester.headBlock,
        indexerLag: Math.max(0, deps.ingester.headBlock - deps.ingester.lastIndexedBlock),
        asOfBlock: asOf()
      });
    })
  );

  v1.get(
    "/packages",
    route(async (req, res) => {
      const q = parse(ListQuery, req.query);
      const items = await deps.store.listAttestations(q);
      const last = items[items.length - 1];
      res.json({ items, nextCursor: items.length === q.limit && last ? last.lastActivityBlock : null, asOfBlock: asOf() });
    })
  );

  v1.get(
    "/packages/:packageId",
    route(async (req, res) => {
      const id = parse(bytes32, req.params.packageId).toLowerCase() as Hex;
      const doc = await deps.store.getAttestation(id);
      if (!doc) throw new HttpError(404, "NOT_FOUND", `no attestation indexed for ${id}`);
      const events = await deps.store.eventsForPackage(id);
      const divergences = events
        .filter((e) => e.type === "DivergenceReported")
        .map((e) => ({ attester: e.actor, observedDigest: e.data.observedDigest, expectedDigest: e.data.expectedDigest, blockNumber: e.blockNumber, txHash: e.txHash, timestamp: e.timestamp }));
      const corroborators = events.filter((e) => e.type === "AttesterCorroborated").map((e) => e.actor);
      res.json({ ...doc, divergences, corroborators, asOfBlock: asOf() });
    })
  );

  v1.get(
    "/packages/:packageId/timeline",
    route(async (req, res) => {
      const id = parse(bytes32, req.params.packageId).toLowerCase() as Hex;
      const events = await deps.store.eventsForPackage(id);
      if (events.length === 0) throw new HttpError(404, "NOT_FOUND", `no events indexed for ${id}`);
      res.json({ events: [...events].reverse(), asOfBlock: asOf() });
    })
  );

  v1.get(
    "/attesters",
    route(async (_req, res) => {
      const [policyEvents, activity, health] = await Promise.all([
        deps.store.eventsOfTypes(["AttesterAdded", "AttesterRemoved", "ThresholdChanged"]),
        deps.store.eventsOfTypes(["AttesterCorroborated", "DivergenceReported"]),
        deps.attesterHealth()
      ]);
      const policy = projectPolicy(policyEvents);
      const byAddr = new Map(health.filter((h) => h.health).map((h) => [h.health!.address.toLowerCase(), h]));
      const stat = (addr: string, type: IndexedEvent["type"]) => activity.filter((e) => e.type === type && e.actor?.toLowerCase() === addr).length;
      const lastSeen = (addr: string) => activity.filter((e) => e.actor?.toLowerCase() === addr).at(-1)?.timestamp ?? null;
      const attesters = policy.attesters.map((address) => {
        const key = address.toLowerCase();
        const h = byAddr.get(key);
        return {
          address,
          label: h?.health?.label ?? deps.attesterLabels?.[key] ?? null,
          active: true,
          online: h !== undefined,
          corroborationCount: stat(key, "AttesterCorroborated"),
          divergenceCount: stat(key, "DivergenceReported"),
          lastSeenAt: lastSeen(key),
          health: h?.health ?? null
        };
      });
      const unregistered = health.filter((h) => h.health && !policy.attesters.some((a) => a.toLowerCase() === h.health!.address.toLowerCase()));
      res.json({
        threshold: policy.threshold,
        attesters,
        unreachable: health.filter((h) => !h.health).map((h) => ({ url: h.url, error: h.error })),
        // false when no attester health URLs are configured (e.g. attesters run on a
        // private machine): the dashboard must then not call them "offline".
        healthConfigured: health.length > 0,
        unregistered: unregistered.map((h) => h.health),
        asOfBlock: asOf()
      });
    })
  );

  v1.get(
    "/events",
    route(async (req, res) => {
      const { limit } = parse(FeedQuery, req.query);
      const events = await deps.store.eventsOfTypes(["AttestationSubmitted", "AttesterCorroborated", "DivergenceReported"], {
        limit,
        newestFirst: true
      });
      const names = new Map<string, { name: string; version: string } | null>();
      const items = [];
      for (const e of events) {
        const id = e.packageId;
        if (id && !names.has(id)) {
          const doc = await deps.store.getAttestation(id);
          names.set(id, doc ? { name: doc.name, version: doc.version } : null);
        }
        const pkg = id ? names.get(id) : null;
        items.push({
          id: e.id,
          type: e.type,
          packageId: id,
          name: pkg?.name ?? null,
          version: pkg?.version ?? null,
          actor: e.actor,
          actorLabel: e.actor ? (deps.attesterLabels?.[e.actor.toLowerCase()] ?? null) : null,
          data: e.data,
          blockNumber: e.blockNumber,
          txHash: e.txHash,
          timestamp: e.timestamp
        });
      }
      res.json({ items, asOfBlock: asOf() });
    })
  );

  v1.get(
    "/divergences",
    route(async (req, res) => {
      const { limit } = parse(FeedQuery, req.query);
      const events = await deps.store.eventsOfTypes(["DivergenceReported"], { limit, newestFirst: true });
      const items = await Promise.all(
        events.map(async (e) => {
          const pkg = e.packageId ? await deps.store.getAttestation(e.packageId) : undefined;
          return {
            packageId: e.packageId,
            name: pkg?.name ?? null,
            version: pkg?.version ?? null,
            attester: e.actor,
            expectedDigest: e.data.expectedDigest,
            observedDigest: e.data.observedDigest,
            blockNumber: e.blockNumber,
            txHash: e.txHash,
            timestamp: e.timestamp
          };
        })
      );
      res.json({ items, asOfBlock: asOf() });
    })
  );

  v1.get(
    "/lookup",
    route(async (req, res) => {
      const { name, version } = parse(LookupQuery, req.query);
      let id: Hex;
      try {
        id = computePackageId("npm", name, version);
      } catch (err) {
        throw new HttpError(400, "BAD_REQUEST", err instanceof Error ? err.message : "invalid package identity");
      }
      const doc = await deps.store.findByNameVersion(name, version);
      res.json({ packageId: id, indexed: doc !== undefined, status: doc?.status ?? null, asOfBlock: asOf() });
    })
  );

  app.use("/api/v1", v1);
  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "no such route" } });
  });
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    log(JSON.stringify({ level: "error", message: err instanceof Error ? err.message : String(err) }));
    res.status(500).json({ error: { code: "INTERNAL", message: "internal error" } });
  });
  return app;
}
