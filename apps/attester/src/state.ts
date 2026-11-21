import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Address, Hex } from "viem";
import { z } from "zod";

/** What this attester last did about a package. */
export type Outcome = "corroborated" | "diverged" | "unreachable" | "self";

export interface PackageState {
  name: string;
  version: string;
  publisher: Address;
  attestedDigest: Hex;
  /** Last digest this attester computed, if the artifact was reachable. */
  observed?: Hex | undefined;
  outcome: Outcome;
  /** True once this attester's corroboration is on-chain. */
  corroborated: boolean;
  /** True once this attester's divergence report is on-chain (at most one per package). */
  divergenceReported: boolean;
  lastTx?: Hex | undefined;
  at: string;
}

export interface AttesterState {
  /** Chain id and registry the state belongs to; a mismatch means a fresh chain. */
  chainId: number;
  registry: Address;
  lastProcessedBlock: number;
  packages: Record<Hex, PackageState>;
}

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/) as unknown as z.ZodType<Hex>;
const StateSchema = z.object({
  chainId: z.number(),
  registry: z.string(),
  lastProcessedBlock: z.number(),
  packages: z.record(
    z.string(),
    z.object({
      name: z.string(),
      version: z.string(),
      publisher: z.string(),
      attestedDigest: hex,
      observed: hex.optional(),
      outcome: z.enum(["corroborated", "diverged", "unreachable", "self"]),
      corroborated: z.boolean(),
      divergenceReported: z.boolean(),
      lastTx: hex.optional(),
      at: z.string()
    })
  )
});

/** Persistence for the idempotency store. */
export interface StateStore {
  load(): AttesterState | undefined;
  save(state: AttesterState): void;
}

/**
 * JSON file under `.attester-state/<label>/state.json`, written atomically (temp file +
 * rename) so a crash mid-write can never leave a half-written store behind.
 */
export class JsonFileStateStore implements StateStore {
  constructor(readonly path: string) {}

  load(): AttesterState | undefined {
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch {
      return undefined;
    }
    const parsed = StateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as AttesterState) : undefined;
  }

  save(state: AttesterState): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, this.path);
  }
}

export class MemoryStateStore implements StateStore {
  state: AttesterState | undefined;
  load() {
    return this.state === undefined ? undefined : structuredClone(this.state);
  }
  save(state: AttesterState) {
    this.state = structuredClone(state);
  }
}
