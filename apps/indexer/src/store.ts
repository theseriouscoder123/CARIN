import type { Hex } from "viem";
import type { AttestationDoc, EventType, IndexMeta, IndexedEvent, ListQuery } from "./types.js";
import { byChainOrder } from "./projection.js";

/**
 * Persistence for the indexer. `events` is the append-only source; `attestations` is a
 * projection rebuilt from it. Both implementations must behave identically.
 */
export interface IndexStore {
  readonly kind: "mongo" | "memory";
  ping(): Promise<boolean>;
  getMeta(): Promise<IndexMeta | undefined>;
  setMeta(meta: IndexMeta): Promise<void>;
  /** Idempotent: an event with an existing id is ignored. */
  insertEvents(events: IndexedEvent[]): Promise<void>;
  /** Remove events with blockNumber > block; returns the packageIds they touched. */
  deleteEventsAfter(block: number): Promise<Hex[]>;
  eventsForPackage(packageId: Hex): Promise<IndexedEvent[]>;
  eventsOfTypes(types: EventType[], opts?: { limit?: number; newestFirst?: boolean }): Promise<IndexedEvent[]>;
  putAttestation(doc: AttestationDoc): Promise<void>;
  deleteAttestation(packageId: Hex): Promise<void>;
  getAttestation(packageId: Hex): Promise<AttestationDoc | undefined>;
  findByNameVersion(name: string, version: string): Promise<AttestationDoc | undefined>;
  listAttestations(q: ListQuery): Promise<AttestationDoc[]>;
  counts(): Promise<{ total: number; verified: number; pending: number; divergent: number }>;
  reset(): Promise<void>;
}

/** Sort for listings: divergent first (pinned), then most recent activity. */
export function listingOrder(a: AttestationDoc, b: AttestationDoc): number {
  const pin = Number(b.status === "DIVERGENT") - Number(a.status === "DIVERGENT");
  return pin || b.lastActivityBlock - a.lastActivityBlock || (a._id < b._id ? -1 : 1);
}

/**
 * In-process store. Used when no MONGODB_URI is configured: the indexer then rebuilds the
 * whole view from chain events on every start, which is exactly the property the design
 * claims (the indexer is a cache anyone can rebuild).
 */
export class MemoryStore implements IndexStore {
  readonly kind = "memory" as const;
  private meta: IndexMeta | undefined;
  private events = new Map<string, IndexedEvent>();
  private attestations = new Map<Hex, AttestationDoc>();

  async ping() {
    return true;
  }
  async getMeta() {
    return this.meta === undefined ? undefined : { ...this.meta };
  }
  async setMeta(meta: IndexMeta) {
    this.meta = { ...meta };
  }
  async insertEvents(events: IndexedEvent[]) {
    for (const e of events) if (!this.events.has(e.id)) this.events.set(e.id, structuredClone(e));
  }
  async deleteEventsAfter(block: number) {
    const touched = new Set<Hex>();
    for (const [id, e] of this.events) {
      if (e.blockNumber > block) {
        if (e.packageId) touched.add(e.packageId);
        this.events.delete(id);
      }
    }
    return [...touched];
  }
  async eventsForPackage(packageId: Hex) {
    return [...this.events.values()].filter((e) => e.packageId === packageId).sort(byChainOrder);
  }
  async eventsOfTypes(types: EventType[], opts: { limit?: number; newestFirst?: boolean } = {}) {
    const out = [...this.events.values()].filter((e) => types.includes(e.type)).sort(byChainOrder);
    if (opts.newestFirst) out.reverse();
    return opts.limit === undefined ? out : out.slice(0, opts.limit);
  }
  async putAttestation(doc: AttestationDoc) {
    this.attestations.set(doc._id, { ...doc });
  }
  async deleteAttestation(packageId: Hex) {
    this.attestations.delete(packageId);
  }
  async getAttestation(packageId: Hex) {
    const d = this.attestations.get(packageId);
    return d === undefined ? undefined : { ...d };
  }
  async findByNameVersion(name: string, version: string) {
    return [...this.attestations.values()].find((d) => d.name === name && d.version === version);
  }
  async listAttestations(q: ListQuery) {
    const needle = q.q?.toLowerCase();
    return [...this.attestations.values()]
      .filter((d) => (needle ? d.name.toLowerCase().includes(needle) : true))
      .filter((d) => (q.status ? d.status === q.status : true))
      .sort(listingOrder)
      .filter((d) => (q.cursor === undefined ? true : d.lastActivityBlock < q.cursor))
      .slice(0, q.limit);
  }
  async counts() {
    const all = [...this.attestations.values()];
    return {
      total: all.length,
      verified: all.filter((d) => d.status === "VERIFIED").length,
      pending: all.filter((d) => d.status === "PENDING").length,
      divergent: all.filter((d) => d.status === "DIVERGENT").length
    };
  }
  async reset() {
    this.meta = undefined;
    this.events.clear();
    this.attestations.clear();
  }
}
