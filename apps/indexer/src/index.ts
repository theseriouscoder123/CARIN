// CAIRN indexer — docs/SPEC-INDEXER-API.md. A cache of chain events, never an authority.
import { CairnClient, CairnError, getChainId, resolveRegistryAddress } from "@cairn/core";
import type { AttesterHealth } from "./api.js";
import { createApi } from "./api.js";
import { loadConfig } from "./config.js";
import { Ingester, clientChainSource } from "./ingest.js";
import { MongoStore } from "./mongo-store.js";
import { MemoryStore, type IndexStore } from "./store.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const log = (msg: string) => process.stdout.write(`[indexer] ${new Date().toISOString().slice(11, 19)} ${msg}\n`);

async function main(): Promise<void> {
  const config = loadConfig();

  let chainId: number | undefined;
  for (let attempt = 0; chainId === undefined; attempt++) {
    try {
      chainId = await getChainId(config.rpcUrl);
    } catch {
      if (attempt === 0) log(`waiting for chain at ${config.rpcUrl} …`);
      await sleep(Math.min(1000 * 2 ** attempt, 10_000));
    }
  }
  const { address, deployment } = resolveRegistryAddress({ chainId, explicit: config.registryAddress, deploymentFile: config.deploymentFile });
  const client = await CairnClient.connect({ rpcUrl: config.rpcUrl, registryAddress: address });

  let store: IndexStore;
  if (config.mongoUri) {
    store = await MongoStore.connect(config.mongoUri, config.mongoDb);
    log(`store: MongoDB (${config.mongoDb})`);
  } else {
    store = new MemoryStore();
    log("store: in-memory (no MONGODB_URI) — rebuilt from chain events on every start");
  }

  const ingester = new Ingester(await clientChainSource(client), store, {
    startBlock: config.startBlock ?? deployment?.deployedAtBlock ?? 0,
    log
  });

  let healthCache: { at: number; value: Awaited<ReturnType<typeof pollAttesters>> } | undefined;
  async function pollAttesters() {
    return Promise.all(
      config.attesterUrls.map(async (url) => {
        try {
          const res = await fetch(`${url.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(1500) });
          if (!res.ok) return { url, error: `HTTP ${res.status}` };
          return { url, health: (await res.json()) as AttesterHealth };
        } catch (err) {
          return { url, error: err instanceof Error ? err.message : String(err) };
        }
      })
    );
  }

  const app = createApi({
    store,
    ingester,
    corsOrigins: config.corsOrigins,
    lagThreshold: config.lagThreshold,
    attesterHealth: async () => {
      if (!healthCache || Date.now() - healthCache.at > 2000) healthCache = { at: Date.now(), value: await pollAttesters() };
      return healthCache.value;
    },
    log: (line) => process.stdout.write(`${line}\n`)
  });
  app.listen(config.port, config.host, () => log(`API http://${config.host}:${config.port}/api/v1 · registry ${address} · chain ${chainId}`));

  for (;;) {
    try {
      await ingester.tick();
    } catch (err) {
      log(`ingestion error (will retry): ${err instanceof Error ? err.message : String(err)}`);
    }
    await sleep(config.pollIntervalMs);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`\nindexer failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(err instanceof CairnError ? 2 : 1);
});
