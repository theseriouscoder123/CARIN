#!/usr/bin/env node
import {
  CairnClient,
  CairnError,
  ChainUnavailableError,
  ConfigError,
  LocalPayloadStore,
  getChainId,
  resolveRegistryAddress
} from "@cairn/core";
import { CachingArtifactSource, FileDigestCache } from "./artifacts.js";
import { renderStatus, runStatus } from "./commands/status.js";
import { runVerify } from "./commands/verify.js";
import { loadPolicy, type FailOnLevel } from "./policy.js";
import { renderVerify } from "./render/verify.js";
import { Command, Option } from "commander";
import { defaultPublishDeps, runPublish } from "./commands/publish.js";
import { cacheDir, defaultRegistryUrl, defaultRpcUrl, payloadDir, type GlobalOptions } from "./config.js";
import { loadAccount } from "./keys.js";
import { renderPublish } from "./render/publish.js";
import { createStyle, shouldColor } from "./render/style.js";

/** SPEC-CLI §3.3: 0 ok · 1 gate fired · 2 operational error. */
export const EXIT = { OK: 0, POLICY: 1, OPERATIONAL: 2 } as const;

const program = new Command()
  .name("cairn")
  .description("Quorum-verified provenance for npm dependencies")
  .version("0.1.0")
  .option("--rpc-url <url>", "chain RPC endpoint (env CAIRN_RPC_URL)", defaultRpcUrl())
  .option("--registry-url <url>", "npm registry (env CAIRN_REGISTRY_URL)", defaultRegistryUrl())
  .option("--contract <address>", "AttestationRegistry address (env CAIRN_REGISTRY_ADDR)")
  .option("--deployment <file>", "deployment JSON (env CAIRN_DEPLOYMENT_FILE)")
  .option("--json", "machine-readable output on stdout only", false)
  .option("--no-color", "disable colour")
  .option("-v, --verbose", "more diagnostics on stderr (repeatable)", (_v, n: number) => n + 1, 0)
  .showHelpAfterError();

function globals(): GlobalOptions {
  const o = program.opts<{
    rpcUrl: string;
    registryUrl: string;
    contract?: string;
    deployment?: string;
    json: boolean;
    color: boolean;
    verbose: number;
  }>();
  return { ...o, color: !o.json && shouldColor(o.color) };
}

function emit(g: GlobalOptions, result: unknown, human: string): void {
  process.stdout.write(g.json ? `${JSON.stringify(result, null, 2)}\n` : `${human}\n`);
}

program
  .command("publish")
  .description("Digest, sign and submit an attestation for a release")
  .argument("[tarball]", "path to a local .tgz")
  .option("--package <name@version>", "resolve and fetch from the registry instead of a local file")
  .option("--key <hex>", "signing key (prefer env CAIRN_PRIVATE_KEY)")
  .addOption(new Option("--payload-store <target>", "where the full payload is stored").choices(["local"]).default("local"))
  .option("--dry-run", "compute and print, submit nothing", false)
  .action(async (tarball: string | undefined, o: { package?: string; key?: string; dryRun: boolean }) => {
    const g = globals();
    const result = await runPublish(
      {
        tarball,
        package: o.package,
        account: loadAccount(o.key),
        dryRun: o.dryRun,
        rpcUrl: g.rpcUrl,
        contract: g.contract,
        deployment: g.deployment
      },
      defaultPublishDeps(g.registryUrl, payloadDir())
    );
    emit(g, result, renderPublish(result, createStyle(g.color)));
  });

async function connectChain(g: GlobalOptions): Promise<CairnClient> {
  const chainId = await getChainId(g.rpcUrl);
  const { address } = resolveRegistryAddress({ chainId, explicit: g.contract, deploymentFile: g.deployment });
  return CairnClient.connect({ rpcUrl: g.rpcUrl, registryAddress: address });
}

const collect = (v: string, prev: string[]) => [...prev, v];

program
  .command("verify")
  .description("Verify every dependency in an npm lockfile against on-chain quorum")
  .option("--lockfile <path>", "npm lockfile (v2/v3)", "./package-lock.json")
  .option("--policy <path>", "policy file (default ./cairn.policy.json, else built-in)")
  .addOption(new Option("--fail-on <level>", "lowest verdict that fails the build").choices(["divergent", "under-quorum", "unattested"]))
  .option("--only <pattern>", "restrict to matching package names (repeatable, * wildcard)", collect, [] as string[])
  .option("--concurrency <n>", "parallel fetches", (v) => Math.max(1, Number.parseInt(v, 10) || 8), 8)
  .option("--offline", "use only the local artifact cache; never fetch", false)
  .action(async (o: { lockfile: string; policy?: string; failOn?: FailOnLevel; only: string[]; concurrency: number; offline: boolean }) => {
    const g = globals();
    const policy = loadPolicy({ path: o.policy, failOn: o.failOn });

    // The gate fails closed: if the chain cannot be read, every dependency is UNKNOWN.
    let chain: CairnClient | undefined;
    let chainError: string | undefined;
    try {
      chain = await connectChain(g);
    } catch (err) {
      if (!(err instanceof ChainUnavailableError || err instanceof ConfigError)) throw err;
      chainError = err.message;
    }

    const showProgress = !g.json && process.stderr.isTTY === true;
    const report = await runVerify(
      { lockfile: o.lockfile, policy, only: o.only, concurrency: o.concurrency },
      {
        artifacts: new CachingArtifactSource(cacheDir(), o.offline),
        chain,
        chainError,
        payloads: new LocalPayloadStore(payloadDir()),
        digests: new FileDigestCache(cacheDir()),
        onProgress: showProgress ? (d, t) => process.stderr.write(`\r  verifying ${d}/${t}…`) : undefined
      }
    );
    if (showProgress) process.stderr.write("\r\u001b[2K");
    emit(g, report, renderVerify(report, createStyle(g.color)));
    process.exitCode = report.exitCode;
  });

program
  .command("status")
  .description("Show the on-chain attestation record for one package")
  .argument("<name@version>")
  .action(async (spec: string) => {
    const g = globals();
    const report = await runStatus(spec, await connectChain(g));
    emit(g, report, renderStatus(report, createStyle(g.color)));
  });

// `pnpm --filter @cairn/cli dev -- publish …` forwards the literal "--"; drop it.
const argv = process.argv[2] === "--" ? [...process.argv.slice(0, 2), ...process.argv.slice(3)] : process.argv;

try {
  await program.parseAsync(argv);
} catch (err) {
  const g = globals();
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof CairnError ? err.code : "UNEXPECTED";
  if (g.json) {
    process.stdout.write(`${JSON.stringify({ error: { code, message } }, null, 2)}\n`);
  } else {
    process.stderr.write(`\n  ${createStyle(shouldColor(g.color, process.stderr)).red("✗")} ${message}\n\n`);
  }
  if (g.verbose > 0 && err instanceof Error) {
    let cause: unknown = err.cause;
    while (cause instanceof Error) {
      process.stderr.write(`    caused by: ${cause.message.split("\n")[0]}\n`);
      cause = cause.cause;
    }
  }
  process.exitCode = EXIT.OPERATIONAL;
}
