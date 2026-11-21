import {
  CairnError,
  RegistryError,
  TransactionError,
  digestArtifact,
  type RegistryAdapter
} from "@cairn/core";
import type { Address, Hex } from "viem";
import type { AttesterState, PackageState, StateStore } from "./state.js";

/** One `AttestationSubmitted` event, as the attester needs it. */
export interface SubmittedEvent {
  packageId: Hex;
  publisher: Address;
  artifactDigest: Hex;
  ecosystem: string;
  name: string;
  version: string;
  blockNumber: bigint;
}

/** The slice of chain access the attester uses. Faked in unit tests. */
export interface ChainPort {
  readonly chainId: number;
  readonly registry: Address;
  readonly address: Address;
  headBlock(): Promise<bigint>;
  submittedEvents(fromBlock: bigint, toBlock: bigint): Promise<SubmittedEvent[]>;
  /** Calls `corroborate(packageId, observed)`; the contract decides match vs divergence. */
  corroborate(packageId: Hex, observed: Hex): Promise<Hex>;
}

export interface AttesterDeps {
  chain: ChainPort;
  registry: RegistryAdapter;
  store: StateStore;
  log?: (msg: string) => void;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => Date;
}

export interface AttesterOptions {
  label: string;
  startBlock: number;
  /** Max block span per getLogs call. */
  blockChunk?: number;
  /** Registry attempts before recording UNREACHABLE (SPEC-ATTESTER §3.2: 3 retries). */
  fetchAttempts?: number;
  /** Upper bound of the randomised pre-submit delay (SPEC-ATTESTER §3.1). */
  maxJitterMs?: number;
  /** How many recent packages a periodic re-check covers. */
  recheckLimit?: number;
}

/** The policy is misconfigured (e.g. this key is not an attester). The process must exit. */
export class FatalAttesterError extends CairnError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("ATTESTER_FATAL", message, options);
  }
}

export type CheckResult =
  | { packageId: Hex; action: "corroborated" | "diverged"; observed: Hex; tx: Hex }
  | { packageId: Hex; action: "unchanged" | "skipped-self" | "already-done"; observed?: Hex }
  | { packageId: Hex; action: "unreachable"; error: string };

export interface AttesterStats {
  label: string;
  address: Address;
  lastProcessedBlock: number;
  processedCount: number;
  divergencesReported: number;
  registryReachable: boolean;
  chainReachable: boolean;
  startedAt: Date;
}

/**
 * Independent attester (SPEC-ATTESTER). Watches `AttestationSubmitted`, re-fetches each
 * artifact from the registry itself, recomputes the digest with the same core function
 * the CLI uses, and reports what it observed. It never takes the publisher's digest as
 * an input to its own computation; it compares only afterwards.
 */
export class Attester {
  private state: AttesterState;
  private readonly log: (msg: string) => void;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => Date;
  registryReachable = true;
  chainReachable = true;
  readonly startedAt: Date;

  constructor(
    private readonly deps: AttesterDeps,
    private readonly opts: AttesterOptions
  ) {
    this.log = deps.log ?? (() => {});
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = deps.random ?? Math.random;
    this.now = deps.now ?? (() => new Date());
    this.startedAt = this.now();

    const loaded = deps.store.load();
    const fresh: AttesterState = {
      chainId: deps.chain.chainId,
      registry: deps.chain.registry,
      lastProcessedBlock: opts.startBlock - 1,
      packages: {}
    };
    // State from another chain or deployment (e.g. Hardhat restarted) is meaningless.
    const compatible =
      loaded !== undefined &&
      loaded.chainId === deps.chain.chainId &&
      loaded.registry.toLowerCase() === deps.chain.registry.toLowerCase();
    if (loaded !== undefined && !compatible) this.log("state belongs to another chain/deployment — starting fresh");
    this.state = compatible ? loaded : fresh;
  }

  get stats(): AttesterStats {
    const pkgs = Object.values(this.state.packages);
    return {
      label: this.opts.label,
      address: this.deps.chain.address,
      lastProcessedBlock: this.state.lastProcessedBlock,
      processedCount: pkgs.filter((p) => p.outcome !== "unreachable").length,
      divergencesReported: pkgs.filter((p) => p.divergenceReported).length,
      registryReachable: this.registryReachable,
      chainReachable: this.chainReachable,
      startedAt: this.startedAt
    };
  }

  get packages(): Readonly<Record<Hex, PackageState>> {
    return this.state.packages;
  }

  private persist(): void {
    this.deps.store.save(this.state);
  }

  /**
   * Backfill/poll: process every event from the last checkpoint to head, then advance the
   * checkpoint. RPC failures propagate; the caller retries and nothing is lost because
   * the checkpoint only moves after a chunk is fully processed.
   */
  async sync(): Promise<number> {
    let head: bigint;
    try {
      head = await this.deps.chain.headBlock();
      this.chainReachable = true;
    } catch (err) {
      this.chainReachable = false;
      throw err;
    }
    let processed = 0;
    const chunk = BigInt(this.opts.blockChunk ?? 2000);
    let from = BigInt(this.state.lastProcessedBlock + 1);
    while (from <= head) {
      const to = from + chunk - 1n < head ? from + chunk - 1n : head;
      const events = await this.deps.chain.submittedEvents(from, to);
      for (const ev of events) {
        await this.handleEvent(ev);
        processed++;
      }
      this.state.lastProcessedBlock = Number(to);
      this.persist();
      from = to + 1n;
    }
    return processed;
  }

  /** First sight of an attestation. */
  async handleEvent(ev: SubmittedEvent): Promise<CheckResult> {
    const known = this.state.packages[ev.packageId];
    if (known !== undefined && known.outcome !== "unreachable") {
      return { packageId: ev.packageId, action: "already-done" };
    }
    if (ev.publisher.toLowerCase() === this.deps.chain.address.toLowerCase()) {
      this.state.packages[ev.packageId] = this.record(ev, { outcome: "self" });
      this.persist();
      this.log(`skip ${ev.name}@${ev.version}: this attester is the publisher`);
      return { packageId: ev.packageId, action: "skipped-self" };
    }
    if (known === undefined) {
      this.state.packages[ev.packageId] = this.record(ev, { outcome: "unreachable" });
    }
    return this.check(ev.packageId);
  }

  /**
   * Fetch, digest, compare, report. Used for first sight and for the Divergence Monitor.
   * Only submits when there is something new to put on-chain.
   */
  async check(packageId: Hex): Promise<CheckResult> {
    const pkg = this.state.packages[packageId];
    if (pkg === undefined) throw new CairnError("UNKNOWN_PACKAGE", `attester has not seen ${packageId}`);
    if (pkg.outcome === "self") return { packageId, action: "skipped-self" };

    let observed: Hex;
    try {
      const bytes = await this.fetchWithRetry(pkg.name, pkg.version);
      observed = digestArtifact(bytes).artifactDigest;
      this.registryReachable = true;
    } catch (err) {
      // Absence is not divergence: record locally, write nothing on-chain.
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof RegistryError) this.registryReachable = false;
      if (!pkg.corroborated && !pkg.divergenceReported) pkg.outcome = "unreachable";
      pkg.at = this.now().toISOString();
      this.persist();
      this.log(`unreachable ${pkg.name}@${pkg.version}: ${message}`);
      return { packageId, action: "unreachable", error: message };
    }
    pkg.observed = observed;

    const matches = observed.toLowerCase() === pkg.attestedDigest.toLowerCase();
    if (matches && pkg.corroborated) return this.unchanged(pkg, packageId, observed);
    if (!matches && pkg.divergenceReported) return this.unchanged(pkg, packageId, observed);

    await this.sleep(Math.floor(this.random() * (this.opts.maxJitterMs ?? 3000)));
    let tx: Hex;
    try {
      tx = await this.deps.chain.corroborate(packageId, observed);
      this.chainReachable = true;
    } catch (err) {
      const name = err instanceof TransactionError ? err.errorName : undefined;
      if (name === "AlreadyCorroborated" || name === "DivergenceAlreadyReported") {
        // Our state was lost but the chain already has our report: treat as success.
        if (matches) pkg.corroborated = true;
        else pkg.divergenceReported = true;
        pkg.outcome = pkg.divergenceReported ? "diverged" : "corroborated";
        pkg.at = this.now().toISOString();
        this.persist();
        return { packageId, action: "already-done", observed };
      }
      if (name === "NotAnAttester") {
        throw new FatalAttesterError(`${this.deps.chain.address} is not an attester in the quorum policy`, { cause: err });
      }
      if (name === "PublisherCannotCorroborate") {
        pkg.outcome = "self";
        this.persist();
        return { packageId, action: "skipped-self" };
      }
      if (!(err instanceof TransactionError)) this.chainReachable = false;
      throw err;
    }

    if (matches) pkg.corroborated = true;
    else pkg.divergenceReported = true;
    pkg.outcome = pkg.divergenceReported ? "diverged" : "corroborated";
    pkg.lastTx = tx;
    pkg.at = this.now().toISOString();
    this.persist();
    const action = matches ? "corroborated" : "diverged";
    this.log(
      matches
        ? `✓ corroborated ${pkg.name}@${pkg.version}  ${observed.slice(0, 10)}…  tx ${tx.slice(0, 10)}…`
        : `✗ DIVERGENCE ${pkg.name}@${pkg.version}  attested ${pkg.attestedDigest.slice(0, 10)}…  observed ${observed.slice(0, 10)}…  tx ${tx.slice(0, 10)}…`
    );
    return { packageId, action, observed, tx };
  }

  /**
   * Divergence Monitor (SPEC-ATTESTER §4): re-fetch the most recently attested packages,
   * or just one when triggered manually.
   */
  async recheck(packageId?: Hex): Promise<CheckResult[]> {
    const ids =
      packageId !== undefined
        ? [packageId]
        : (Object.entries(this.state.packages) as [Hex, PackageState][])
            .filter(([, p]) => p.outcome !== "self")
            .sort(([, a], [, b]) => b.at.localeCompare(a.at))
            .slice(0, this.opts.recheckLimit ?? 50)
            .map(([id]) => id);
    const results: CheckResult[] = [];
    for (const id of ids) results.push(await this.check(id));
    return results;
  }

  private unchanged(pkg: PackageState, packageId: Hex, observed: Hex): CheckResult {
    pkg.at = this.now().toISOString();
    this.persist();
    return { packageId, action: "unchanged", observed };
  }

  private record(ev: SubmittedEvent, extra: Partial<PackageState>): PackageState {
    return {
      name: ev.name,
      version: ev.version,
      publisher: ev.publisher,
      attestedDigest: ev.artifactDigest,
      outcome: "unreachable",
      corroborated: false,
      divergenceReported: false,
      at: this.now().toISOString(),
      ...extra
    };
  }

  private async fetchWithRetry(name: string, version: string): Promise<Uint8Array> {
    const attempts = this.opts.fetchAttempts ?? 4; // 1 try + 3 retries
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        const ref = await this.deps.registry.resolve(name, version);
        return await this.deps.registry.fetch(ref);
      } catch (err) {
        last = err;
        if (i < attempts - 1) await this.sleep(500 * 2 ** i);
      }
    }
    throw last;
  }
}
