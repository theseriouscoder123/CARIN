import { readFile } from "node:fs/promises";
import {
  CairnClient,
  ConfigError,
  LocalPayloadStore,
  ManifestError,
  NpmAdapter,
  TransactionError,
  getChainId,
  preparePublication,
  readPackageManifest,
  resolveRegistryAddress,
  signAttestation,
  type PayloadStore,
  type RegistryAdapter
} from "@cairn/core";
import { zeroAddress, type Address, type Hex, type LocalAccount } from "viem";

export interface PublishOptions {
  tarball?: string | undefined;
  /** `name@version` to resolve from the registry instead of a local file. */
  package?: string | undefined;
  account?: LocalAccount | undefined;
  dryRun: boolean;
  rpcUrl: string;
  contract?: string | undefined;
  deployment?: string | undefined;
}

export interface PublishDeps {
  adapter: RegistryAdapter;
  payloadStore: PayloadStore;
  readFile?: (path: string) => Promise<Uint8Array>;
  connect?: (rpcUrl: string, registry: Address) => Promise<CairnClient>;
}

export type PublishStatus = "dry-run" | "submitted" | "already-attested";

export interface PublishResult {
  schema: "cairn.publish.v1";
  status: PublishStatus;
  source: string;
  name: string;
  version: string;
  packageId: Hex;
  files: number;
  artifactDigest: Hex;
  tarballHash: Hex;
  payloadDigest: Hex;
  publisher: Address | null;
  payloadLocation?: string;
  chainId?: number;
  registry?: Address;
  txHash?: Hex;
  blockNumber?: string;
  warnings: string[];
}

/** Split `@scope/name@1.2.3` / `name@1.2.3` at the version separator. */
export function parseSpec(spec: string): { name: string; version: string } {
  const at = spec.lastIndexOf("@");
  if (at <= 0) throw new ConfigError(`expected name@version, got ${JSON.stringify(spec)}`);
  return { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

/** `cairn publish` (SPEC-CLI §2). Returns a result object; rendering is separate. */
export async function runPublish(opts: PublishOptions, deps: PublishDeps): Promise<PublishResult> {
  if ((opts.tarball === undefined) === (opts.package === undefined)) {
    throw new ConfigError("pass exactly one of: a tarball path, or --package <name@version>");
  }
  if (!opts.dryRun && opts.account === undefined) {
    throw new ConfigError("a signing key is required: set CAIRN_PRIVATE_KEY (preferred) or pass --key");
  }

  // 1. obtain artifact bytes
  let bytes: Uint8Array;
  let source: string;
  let requested: { name: string; version: string } | undefined;
  if (opts.package !== undefined) {
    requested = parseSpec(opts.package);
    const ref = await deps.adapter.resolve(requested.name, requested.version);
    bytes = await deps.adapter.fetch(ref);
    source = ref.tarballUrl;
  } else {
    const path = opts.tarball as string;
    bytes = await (deps.readFile ?? ((p: string) => readFile(p)))(path);
    source = path;
  }

  // identity comes from the artifact's own package.json
  const manifest = readPackageManifest(bytes);
  if (requested && (manifest.name !== requested.name || manifest.version !== requested.version)) {
    throw new ManifestError(
      `registry served ${manifest.name}@${manifest.version} for ${requested.name}@${requested.version}`
    );
  }

  // 2–3. canonicalise, digest, payload
  const publisher = opts.account?.address ?? zeroAddress;
  const pub = preparePublication({
    bytes,
    ecosystem: "npm",
    name: manifest.name,
    version: manifest.version,
    publisher
  });

  const base: PublishResult = {
    schema: "cairn.publish.v1",
    status: "dry-run",
    source,
    name: pub.name,
    version: pub.version,
    packageId: pub.packageId,
    files: pub.tree.entries.length,
    artifactDigest: pub.artifactDigest,
    tarballHash: pub.tarballHash,
    payloadDigest: pub.payloadDigest,
    publisher: opts.account?.address ?? null,
    warnings: pub.tree.warnings
  };
  if (opts.dryRun) return base;
  const account = opts.account as LocalAccount;

  // chain: resolve the registry and fail early on states the contract would reject
  const chainId = await getChainId(opts.rpcUrl);
  const { address: registry } = resolveRegistryAddress({
    chainId,
    explicit: opts.contract,
    deploymentFile: opts.deployment
  });
  const client = await (deps.connect ?? ((rpcUrl, r) => CairnClient.connect({ rpcUrl, registryAddress: r })))(
    opts.rpcUrl,
    registry
  );

  const existing = await client.getRecord(pub.packageId);
  if (existing.exists) {
    if (existing.artifactDigest === pub.artifactDigest) {
      return { ...base, status: "already-attested", chainId, registry, payloadDigest: existing.payloadDigest };
    }
    throw new TransactionError(
      `${pub.name}@${pub.version} is already attested with a different artifactDigest ` +
        `(${existing.artifactDigest}). Records are append-only; publish a new version.`
    );
  }
  const pinned = await client.publisherOf("npm", pub.name);
  if (pinned !== zeroAddress && pinned.toLowerCase() !== account.address.toLowerCase()) {
    throw new TransactionError(`${pub.name} is pinned to publisher ${pinned}; this key is ${account.address}`);
  }

  // 4. store the payload; 5. sign; 6. submit
  const stored = await deps.payloadStore.put(pub.payload);
  const nonce = await client.nonceOf(account.address);
  const signature = await signAttestation(account, chainId, registry, {
    ecosystem: pub.ecosystem,
    name: pub.name,
    version: pub.version,
    artifactDigest: pub.artifactDigest,
    tarballHash: pub.tarballHash,
    payloadDigest: pub.payloadDigest,
    nonce
  });
  const tx = await client.submit(account, {
    packageId: pub.packageId,
    ecosystem: pub.ecosystem,
    name: pub.name,
    version: pub.version,
    artifactDigest: pub.artifactDigest,
    tarballHash: pub.tarballHash,
    payloadDigest: pub.payloadDigest,
    publisher: account.address,
    nonce,
    signature
  });

  return {
    ...base,
    status: "submitted",
    payloadLocation: stored.location,
    chainId,
    registry,
    txHash: tx.hash,
    blockNumber: tx.blockNumber.toString()
  };
}

export function defaultPublishDeps(registryUrl: string, payloadDir: string): PublishDeps {
  return {
    adapter: new NpmAdapter({ registryUrl }),
    payloadStore: new LocalPayloadStore(payloadDir)
  };
}
