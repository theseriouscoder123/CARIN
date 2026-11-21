// CAIRN attester daemon — docs/SPEC-ATTESTER.md. One process, one key.
import { join } from "node:path";
import { CairnClient, CairnError, NpmAdapter, getChainId, resolveRegistryAddress } from "@cairn/core";
import { privateKeyToAccount } from "viem/accounts";
import { Attester, FatalAttesterError } from "./attester.js";
import { clientChainPort } from "./chain-port.js";
import { loadConfig } from "./config.js";
import { startServer } from "./server.js";
import { JsonFileStateStore } from "./state.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const config = loadConfig();
  const log = (msg: string) => process.stdout.write(`[${config.label}] ${new Date().toISOString().slice(11, 19)} ${msg}\n`);
  const account = privateKeyToAccount(config.key);

  // Wait for the chain rather than crash: attesters are often started before `pnpm chain`.
  let chainId: number | undefined;
  for (let attempt = 0; chainId === undefined; attempt++) {
    try {
      chainId = await getChainId(config.rpcUrl);
    } catch {
      if (attempt === 0) log(`waiting for chain at ${config.rpcUrl} …`);
      await sleep(Math.min(1000 * 2 ** attempt, 10_000));
    }
  }
  const { address: registry, deployment } = resolveRegistryAddress({
    chainId,
    explicit: config.registryAddress,
    deploymentFile: config.deploymentFile
  });
  const client = await CairnClient.connect({ rpcUrl: config.rpcUrl, registryAddress: registry });
  if (!(await client.isAttester(account.address))) {
    throw new FatalAttesterError(`${account.address} is not registered in the quorum policy — refusing to start`);
  }

  const attester = new Attester(
    {
      chain: clientChainPort(client, account),
      registry: new NpmAdapter({ registryUrl: config.npmRegistry }),
      store: new JsonFileStateStore(join(config.stateDir, config.label, "state.json")),
      log
    },
    { label: config.label, startBlock: config.startBlock ?? deployment?.deployedAtBlock ?? 0 }
  );
  startServer(attester, config.port);
  log(`up · ${account.address} · chain ${chainId} · registry ${registry}`);
  log(`npm ${config.npmRegistry} · health http://127.0.0.1:${config.port}/health`);

  let nextRecheck = Date.now() + config.recheckIntervalSec * 1000;
  let backoff = config.pollIntervalMs;
  for (;;) {
    try {
      await attester.sync();
      if (Date.now() >= nextRecheck) {
        await attester.recheck();
        nextRecheck = Date.now() + config.recheckIntervalSec * 1000;
      }
      backoff = config.pollIntervalMs;
    } catch (err) {
      if (err instanceof FatalAttesterError) throw err;
      // RPC hiccup: retry with backoff. The checkpoint has not moved, so nothing is lost.
      log(`retrying after error: ${err instanceof Error ? err.message : String(err)}`);
      backoff = Math.min(backoff * 2, 30_000);
    }
    await sleep(backoff);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\nattester failed: ${msg}\n`);
  process.exit(err instanceof CairnError ? 2 : 1);
});
