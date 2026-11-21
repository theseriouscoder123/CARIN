import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Hex } from "viem";
import { z } from "zod";
import type { Attester } from "./attester.js";

const RecheckBody = z.object({
  packageId: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional()
});

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    // the dashboard polls /health from the browser
    "access-control-allow-origin": "*"
  });
  res.end(JSON.stringify(body, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 16 * 1024) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? {} : JSON.parse(text);
}

/**
 * `GET /health` (SPEC-ATTESTER §6) and `POST /admin/recheck` (§4). Bound to localhost:
 * the manual trigger is a demo/operator tool, never exposed to the network.
 */
export function startServer(attester: Attester, port: number, host = "127.0.0.1"): Server {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (req.method === "GET" && req.url === "/health") {
          const s = attester.stats;
          return send(res, 200, {
            label: s.label,
            address: s.address,
            lastProcessedBlock: s.lastProcessedBlock,
            processedCount: s.processedCount,
            divergencesReported: s.divergencesReported,
            registryReachable: s.registryReachable,
            chainReachable: s.chainReachable,
            uptimeSeconds: Math.floor((Date.now() - s.startedAt.getTime()) / 1000)
          });
        }
        if (req.method === "GET" && req.url === "/packages") {
          return send(res, 200, attester.packages);
        }
        if (req.method === "POST" && req.url === "/admin/recheck") {
          const body = RecheckBody.safeParse(await readBody(req));
          if (!body.success) return send(res, 400, { error: "packageId must be a 0x-prefixed bytes32" });
          const results = await attester.recheck(body.data.packageId as Hex | undefined);
          return send(res, 200, { results });
        }
        send(res, 404, { error: "not found" });
      } catch (err) {
        send(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    })();
  });
  server.listen(port, host);
  return server;
}
