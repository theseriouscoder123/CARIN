import { MongoClient, type Collection, type Db } from "mongodb";
import type { Hex } from "viem";
import type { IndexStore } from "./store.js";
import type { AttestationDoc, EventType, IndexMeta, IndexedEvent, ListQuery } from "./types.js";

type EventDoc = Omit<IndexedEvent, "id"> & { _id: string };
type MetaDoc = IndexMeta & { _id: "meta" };

const fromDoc = ({ _id, ...rest }: EventDoc): IndexedEvent => ({ id: _id, ...rest });

/** MongoDB store (SPEC-INDEXER-API §2). Atlas in deployment, Docker locally. */
export class MongoStore implements IndexStore {
  readonly kind = "mongo" as const;
  private constructor(
    private readonly client: MongoClient,
    private readonly db: Db
  ) {}

  static async connect(uri: string, dbName: string): Promise<MongoStore> {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    const store = new MongoStore(client, client.db(dbName));
    await store.ensureIndexes();
    return store;
  }

  private get events(): Collection<EventDoc> {
    return this.db.collection<EventDoc>("events");
  }
  private get attestations(): Collection<AttestationDoc> {
    return this.db.collection<AttestationDoc>("attestations");
  }
  private get meta(): Collection<MetaDoc> {
    return this.db.collection<MetaDoc>("meta");
  }

  private async ensureIndexes() {
    await Promise.all([
      this.attestations.createIndex({ name: 1, version: 1 }),
      this.attestations.createIndex({ submittedAt: -1 }),
      this.attestations.createIndex({ quorumReached: 1 }),
      this.attestations.createIndex({ divergenceCount: -1 }),
      this.attestations.createIndex({ status: 1, lastActivityBlock: -1 }),
      this.attestations.createIndex({ name: "text" }),
      this.events.createIndex({ packageId: 1, blockNumber: 1, logIndex: 1 }),
      this.events.createIndex({ type: 1, blockNumber: -1, logIndex: -1 }),
      this.events.createIndex({ blockNumber: 1 })
    ]);
  }

  async close() {
    await this.client.close();
  }

  async ping() {
    try {
      await this.db.command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async getMeta() {
    const m = await this.meta.findOne({ _id: "meta" });
    if (!m) return undefined;
    const { _id: _ignored, ...rest } = m;
    return rest;
  }
  async setMeta(meta: IndexMeta) {
    await this.meta.replaceOne({ _id: "meta" }, { ...meta }, { upsert: true });
  }

  async insertEvents(events: IndexedEvent[]) {
    if (events.length === 0) return;
    // Upsert on the (txHash, logIndex) id: replays and reorg re-ingestion are harmless.
    await this.events.bulkWrite(
      events.map(({ id, ...rest }) => ({
        updateOne: { filter: { _id: id }, update: { $setOnInsert: { _id: id, ...rest } }, upsert: true }
      })),
      { ordered: false }
    );
  }

  async deleteEventsAfter(block: number) {
    const touched = await this.events.distinct("packageId", { blockNumber: { $gt: block } });
    await this.events.deleteMany({ blockNumber: { $gt: block } });
    return touched.filter((p): p is Hex => typeof p === "string");
  }

  async eventsForPackage(packageId: Hex) {
    const docs = await this.events.find({ packageId }).sort({ blockNumber: 1, logIndex: 1 }).toArray();
    return docs.map(fromDoc);
  }

  async eventsOfTypes(types: EventType[], opts: { limit?: number; newestFirst?: boolean } = {}) {
    const dir = opts.newestFirst ? -1 : 1;
    let cursor = this.events.find({ type: { $in: types } }).sort({ blockNumber: dir, logIndex: dir });
    if (opts.limit !== undefined) cursor = cursor.limit(opts.limit);
    return (await cursor.toArray()).map(fromDoc);
  }

  async putAttestation(doc: AttestationDoc) {
    await this.attestations.replaceOne({ _id: doc._id }, doc, { upsert: true });
  }
  async deleteAttestation(packageId: Hex) {
    await this.attestations.deleteOne({ _id: packageId });
  }
  async getAttestation(packageId: Hex) {
    return (await this.attestations.findOne({ _id: packageId })) ?? undefined;
  }
  async findByNameVersion(name: string, version: string) {
    return (await this.attestations.findOne({ name, version })) ?? undefined;
  }

  async listAttestations(q: ListQuery) {
    const filter: Record<string, unknown> = {};
    if (q.q) filter.name = { $regex: q.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    if (q.status) filter.status = q.status;
    if (q.cursor !== undefined) filter.lastActivityBlock = { $lt: q.cursor };
    const docs = await this.attestations.find(filter).sort({ lastActivityBlock: -1, _id: 1 }).limit(q.limit).toArray();
    // Divergent packages are pinned to the top of the first page.
    if (q.cursor === undefined && !q.status) {
      const divergent = await this.attestations.find({ ...filter, status: "DIVERGENT" }).sort({ lastActivityBlock: -1 }).toArray();
      const ids = new Set(divergent.map((d) => d._id));
      return [...divergent, ...docs.filter((d) => !ids.has(d._id))].slice(0, q.limit);
    }
    return docs;
  }

  async counts() {
    const [total, verified, pending, divergent] = await Promise.all([
      this.attestations.countDocuments(),
      this.attestations.countDocuments({ status: "VERIFIED" }),
      this.attestations.countDocuments({ status: "PENDING" }),
      this.attestations.countDocuments({ status: "DIVERGENT" })
    ]);
    return { total, verified, pending, divergent };
  }

  async reset() {
    await Promise.all([this.events.deleteMany({}), this.attestations.deleteMany({}), this.meta.deleteMany({})]);
  }
}
