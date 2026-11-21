import { attestationRegistryAbi, quorumPolicyAbi, type CairnClient } from "@cairn/core";
import { BlockNotFoundError, parseEventLogs, type Address, type Hex } from "viem";
import { projectAttestation } from "./projection.js";
import type { IndexStore } from "./store.js";
import { EVENT_TYPES, type EventType, type IndexMeta, type IndexedEvent } from "./types.js";

/** Chain access the ingester needs. Faked in tests. */
export interface ChainSource {
  readonly chainId: number;
  readonly registry: Address;
  head(): Promise<number>;
  blockHash(block: number): Promise<Hex | undefined>;
  /** Every registry + policy event in [from, to], decoded. */
  logs(from: number, to: number): Promise<IndexedEvent[]>;
}

const ABI = [...attestationRegistryAbi, ...quorumPolicyAbi];

function plain(v: unknown): string | number | boolean {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
}

/** The real ChainSource over the shared core client. */
export async function clientChainSource(client: CairnClient): Promise<ChainSource> {
  const policy = await client.quorumPolicyAddress();
  const timestamps = new Map<bigint, string>();
  return {
    chainId: client.chainId,
    registry: client.registry,
    head: async () => Number(await client.public.getBlockNumber()),
    blockHash: async (block) => {
      if (block < 0) return undefined;
      try {
        return (await client.public.getBlock({ blockNumber: BigInt(block) })).hash ?? undefined;
      } catch (err) {
        // Only a block that genuinely does not exist counts as "changed". An RPC failure
        // must propagate: treating it as a hash mismatch would wipe the index on any blip.
        if (err instanceof BlockNotFoundError) return undefined;
        throw err;
      }
    },
    async logs(from, to) {
      const raw = await client.public.getLogs({ address: [client.registry, policy], fromBlock: BigInt(from), toBlock: BigInt(to) });
      const parsed = parseEventLogs({ abi: ABI, logs: raw, strict: true });
      const out: IndexedEvent[] = [];
      for (const log of parsed) {
        if (!(EVENT_TYPES as readonly string[]).includes(log.eventName)) continue;
        const type = log.eventName as EventType;
        let ts = timestamps.get(log.blockNumber);
        if (ts === undefined) {
          const block = await client.public.getBlock({ blockNumber: log.blockNumber });
          ts = new Date(Number(block.timestamp) * 1000).toISOString();
          timestamps.set(log.blockNumber, ts);
        }
        const args = log.args as Record<string, unknown>;
        const data: Record<string, string | number | boolean> = {};
        for (const [k, v] of Object.entries(args)) data[k] = plain(v);
        const actor = (args.publisher ?? args.attester) as Address | undefined;
        out.push({
          id: `${log.transactionHash}:${log.logIndex}`,
          type,
          packageId: args.packageId as Hex | undefined,
          actor,
          data,
          blockNumber: Number(log.blockNumber),
          blockHash: log.blockHash,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          timestamp: ts
        });
      }
      return out;
    }
  };
}

const MIN_LOG_CHUNK = 10;

export interface IngesterOptions {
  startBlock: number;
  chunk?: number;
  log?: (msg: string) => void;
}

/**
 * Backfill + poll ingestion (SPEC-INDEXER-API §1). Idempotent by (txHash, logIndex),
 * checkpointed per batch. Any block-hash mismatch at the checkpoint — a reorg, or a local
 * chain restarted underneath us — triggers a full rebuild from the start block.
 */
export class Ingester {
  headBlock = 0;
  lastIndexedBlock = -1;
  /** Current getLogs range; shrinks automatically to fit the provider's cap. */
  private chunk: number;
  private readonly log: (msg: string) => void;

  constructor(
    private readonly chain: ChainSource,
    private readonly store: IndexStore,
    private readonly opts: IngesterOptions
  ) {
    this.log = opts.log ?? (() => {});
    this.chunk = opts.chunk ?? 2000;
  }

  private fresh(): IndexMeta {
    return { chainId: this.chain.chainId, registry: this.chain.registry, lastIndexedBlock: this.opts.startBlock - 1, lastIndexedHash: null };
  }

  private async rebuild(reason: string): Promise<IndexMeta> {
    this.log(`rebuilding index from block ${this.opts.startBlock}: ${reason}`);
    await this.store.reset();
    const meta = this.fresh();
    await this.store.setMeta(meta);
    return meta;
  }

  private async reproject(packageIds: Iterable<Hex>): Promise<void> {
    for (const id of new Set(packageIds)) {
      const doc = projectAttestation(await this.store.eventsForPackage(id));
      if (doc) await this.store.putAttestation(doc);
      else await this.store.deleteAttestation(id);
    }
  }

  /** One ingestion pass: verify the checkpoint, then index everything up to head. */
  async tick(): Promise<number> {
    let meta = await this.store.getMeta();
    if (meta === undefined) meta = await this.rebuild("empty store");
    else if (meta.chainId !== this.chain.chainId || meta.registry.toLowerCase() !== this.chain.registry.toLowerCase()) {
      meta = await this.rebuild("store belongs to another chain or deployment");
    }

    const head = await this.chain.head();
    this.headBlock = head;
    if (meta.lastIndexedBlock > head) meta = await this.rebuild(`chain head ${head} is behind checkpoint ${meta.lastIndexedBlock}`);
    else if (meta.lastIndexedHash !== null) {
      const hash = await this.chain.blockHash(meta.lastIndexedBlock);
      if (hash !== meta.lastIndexedHash) meta = await this.rebuild(`block ${meta.lastIndexedBlock} hash changed (reorg or chain reset)`);
    }

    let ingested = 0;
    let from = meta.lastIndexedBlock + 1;
    while (from <= head) {
      const to = Math.min(from + this.chunk - 1, head);
      let events: IndexedEvent[];
      try {
        events = await this.chain.logs(from, to);
      } catch (err) {
        // Providers cap eth_getLogs ranges differently (Base's public RPC: 200 blocks).
        if (this.chunk <= MIN_LOG_CHUNK) throw err;
        this.chunk = Math.max(MIN_LOG_CHUNK, Math.floor(this.chunk / 2));
        this.log(`log query failed for ${to - from + 1} blocks; retrying with ${this.chunk}-block ranges`);
        continue;
      }
      await this.store.insertEvents(events);
      await this.reproject(events.flatMap((e) => (e.packageId ? [e.packageId] : [])));
      meta = { ...meta, lastIndexedBlock: to, lastIndexedHash: (await this.chain.blockHash(to)) ?? null };
      await this.store.setMeta(meta);
      ingested += events.length;
      from = to + 1;
    }
    this.lastIndexedBlock = meta.lastIndexedBlock;
    if (ingested > 0) this.log(`indexed ${ingested} event(s) up to block ${meta.lastIndexedBlock}`);
    return ingested;
  }
}
