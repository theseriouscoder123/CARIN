import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseAbiItem,
  stringToBytes,
  type Address,
  type Chain,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type TransactionReceipt
} from "viem";
import { attestationRegistryAbi, quorumPolicyAbi } from "./abi.js";
import { ChainUnavailableError, TransactionError } from "./errors.js";

/** On-chain view of one packageId, read at a single block for consistency. */
export interface OnChainRecord {
  packageId: Hex;
  exists: boolean;
  artifactDigest: Hex;
  tarballHash: Hex;
  payloadDigest: Hex;
  publisher: Address;
  submittedAt: bigint;
  corroborations: number;
  hasQuorum: boolean;
  threshold: number;
  attesterCount: number;
  divergences: { attester: Address; observedDigest: Hex; reportedAt: bigint }[];
  blockNumber: bigint;
}

export interface SubmitArgs {
  packageId: Hex;
  ecosystem: string;
  name: string;
  version: string;
  artifactDigest: Hex;
  tarballHash: Hex;
  payloadDigest: Hex;
  publisher: Address;
  nonce: bigint;
  signature: Hex;
}

export interface TxResult {
  hash: Hex;
  blockNumber: bigint;
  receipt: TransactionReceipt;
}

export interface CairnClientConfig {
  rpcUrl: string;
  registryAddress: Address;
}

export const attestationSubmittedEvent = parseAbiItem(
  "event AttestationSubmitted(bytes32 indexed packageId, address indexed publisher, bytes32 artifactDigest, bytes32 tarballHash, bytes32 payloadDigest, string ecosystem, string name, string version)"
);

/** keccak256("<ecosystem>:<name>") — the key of the publisher pin. */
export function nameId(ecosystem: string, name: string): Hex {
  return keccak256(stringToBytes(`${ecosystem}:${name}`));
}

/** The bare custom-error name of a viem revert, e.g. "AlreadyCorroborated". */
export function revertErrorName(err: unknown): string | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
  return reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined;
}

/** Pull the custom-error name and args out of a viem revert, if there is one. */
export function revertReason(err: unknown): string | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError) {
    const data = reverted.data;
    if (data) return `${data.errorName}(${(data.args ?? []).map(String).join(", ")})`;
    return reverted.reason ?? reverted.shortMessage;
  }
  return undefined;
}

async function wrapRead<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    throw new ChainUnavailableError(`chain read failed (${what})`, { cause });
  }
}

/** Probe an RPC endpoint for its chain id. Throws ChainUnavailableError if unreachable. */
export async function getChainId(rpcUrl: string): Promise<number> {
  const probe = createPublicClient({ transport: http(rpcUrl, { retryCount: 1, timeout: 10_000 }) });
  return wrapRead(`chain id from ${rpcUrl}`, () => probe.getChainId());
}

/**
 * The one chain client shared by the CLI, attester and indexer (ARCHITECTURE §4.3).
 * Reads are authoritative contract state; nothing here consults the indexer.
 */
export class CairnClient {
  readonly chain: Chain;
  readonly public: PublicClient;
  readonly registry: Address;
  readonly rpcUrl: string;

  private constructor(chain: Chain, rpcUrl: string, registry: Address) {
    this.chain = chain;
    this.rpcUrl = rpcUrl;
    this.registry = registry;
    this.public = createPublicClient({ chain, transport: http(rpcUrl, { retryCount: 2, timeout: 20_000 }) });
  }

  static async connect(config: CairnClientConfig): Promise<CairnClient> {
    const chainId = await getChainId(config.rpcUrl);
    const chain = defineChain({
      id: chainId,
      name: `cairn-${chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } }
    });
    const client = new CairnClient(chain, config.rpcUrl, config.registryAddress);
    const code = await wrapRead("registry bytecode", () =>
      client.public.getCode({ address: config.registryAddress })
    );
    if (code === undefined || code === "0x") {
      throw new ChainUnavailableError(
        `no contract at ${config.registryAddress} on chain ${chainId} — is the deployment stale ` +
          `(Hardhat restarted)? Re-run the deploy script.`
      );
    }
    return client;
  }

  get chainId(): number {
    return this.chain.id;
  }

  async quorumPolicyAddress(): Promise<Address> {
    return wrapRead("quorumPolicy", () =>
      this.public.readContract({ address: this.registry, abi: attestationRegistryAbi, functionName: "quorumPolicy" })
    );
  }

  /** Full record for one packageId, every field read at the same block. */
  async getRecord(packageId: Hex): Promise<OnChainRecord> {
    return wrapRead(`record ${packageId}`, async () => {
      const blockNumber = await this.public.getBlockNumber();
      const at = { address: this.registry, abi: attestationRegistryAbi, blockNumber } as const;
      const policy = await this.public.readContract({ ...at, functionName: "quorumPolicy" });
      const p = { address: policy, abi: quorumPolicyAbi, blockNumber } as const;
      const [rec, hasQuorum, divergences, threshold, attesterCount] = await Promise.all([
        this.public.readContract({ ...at, functionName: "getAttestation", args: [packageId] }),
        this.public.readContract({ ...at, functionName: "hasQuorum", args: [packageId] }),
        this.public.readContract({ ...at, functionName: "getDivergences", args: [packageId] }),
        this.public.readContract({ ...p, functionName: "threshold" }),
        this.public.readContract({ ...p, functionName: "attesterCount" })
      ]);
      return {
        packageId,
        exists: rec.submittedAt !== 0n,
        artifactDigest: rec.artifactDigest,
        tarballHash: rec.tarballHash,
        payloadDigest: rec.payloadDigest,
        publisher: rec.publisher,
        submittedAt: rec.submittedAt,
        corroborations: rec.corroborations,
        hasQuorum,
        threshold,
        attesterCount,
        divergences: divergences.map((d) => ({
          attester: d.attester,
          observedDigest: d.observedDigest,
          reportedAt: d.reportedAt
        })),
        blockNumber
      };
    });
  }

  async nonceOf(publisher: Address): Promise<bigint> {
    return wrapRead("nonceOf", () =>
      this.public.readContract({
        address: this.registry,
        abi: attestationRegistryAbi,
        functionName: "nonceOf",
        args: [publisher]
      })
    );
  }

  async publisherOf(ecosystem: string, name: string): Promise<Address> {
    return wrapRead("publisherOf", () =>
      this.public.readContract({
        address: this.registry,
        abi: attestationRegistryAbi,
        functionName: "publisherOf",
        args: [nameId(ecosystem, name)]
      })
    );
  }

  async isAttester(who: Address): Promise<boolean> {
    const policy = await this.quorumPolicyAddress();
    return wrapRead("isAttester", () =>
      this.public.readContract({ address: policy, abi: quorumPolicyAbi, functionName: "isAttester", args: [who] })
    );
  }

  async hasCorroborated(packageId: Hex, attester: Address): Promise<boolean> {
    return wrapRead("hasCorroborated", () =>
      this.public.readContract({
        address: this.registry,
        abi: attestationRegistryAbi,
        functionName: "hasCorroborated",
        args: [packageId, attester]
      })
    );
  }

  /** `AttestationSubmitted` logs in a block range. */
  async getSubmittedEvents(fromBlock: bigint, toBlock: bigint) {
    return wrapRead("AttestationSubmitted logs", () =>
      this.public.getLogs({ address: this.registry, event: attestationSubmittedEvent, fromBlock, toBlock, strict: true })
    );
  }

  private wallet(account: LocalAccount) {
    return createWalletClient({ account, chain: this.chain, transport: http(this.rpcUrl) });
  }

  /** Simulate first so a revert surfaces as a named custom error, then send and wait. */
  private async send(
    account: LocalAccount,
    functionName: "submit" | "corroborate",
    args: readonly unknown[]
  ): Promise<TxResult> {
    let request;
    try {
      ({ request } = await this.public.simulateContract({
        account,
        address: this.registry,
        abi: attestationRegistryAbi,
        functionName,
        args: args as never
      }));
    } catch (cause) {
      const reason = revertReason(cause);
      if (reason !== undefined) {
        throw new TransactionError(`${functionName} would revert: ${reason}`, {
          cause,
          errorName: revertErrorName(cause)
        });
      }
      throw new ChainUnavailableError(`${functionName} simulation failed`, { cause });
    }
    try {
      const hash = await this.wallet(account).writeContract(request);
      const receipt = await this.public.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new TransactionError(`${functionName} reverted in tx ${hash}`);
      return { hash, blockNumber: receipt.blockNumber, receipt };
    } catch (cause) {
      if (cause instanceof TransactionError) throw cause;
      throw new TransactionError(`${functionName} transaction failed`, { cause });
    }
  }

  /** Submit a signed attestation. `relayer` pays gas; it need not be the publisher. */
  async submit(relayer: LocalAccount, a: SubmitArgs): Promise<TxResult> {
    return this.send(relayer, "submit", [
      a.packageId,
      a.ecosystem,
      a.name,
      a.version,
      a.artifactDigest,
      a.tarballHash,
      a.payloadDigest,
      a.publisher,
      a.nonce,
      a.signature
    ]);
  }

  /** Report an independently computed digest; the contract decides match vs divergence. */
  async corroborate(attester: LocalAccount, packageId: Hex, observedDigest: Hex): Promise<TxResult> {
    return this.send(attester, "corroborate", [packageId, observedDigest]);
  }
}
