import { existsSync, readFileSync } from "node:fs";
import { ConfigError } from "@cairn/core";
import { z } from "zod";

export const VERDICTS = ["PASS", "UNDER_QUORUM", "UNATTESTED", "DIVERGENT", "CONTESTED", "UNKNOWN"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** Verdicts an allowlist entry may never suppress: they are the alarm itself. */
export const UNSUPPRESSIBLE: readonly Verdict[] = ["DIVERGENT", "CONTESTED"];

const AllowEntry = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  reason: z.string().min(1, "allowlist entries require a reason"),
  expires: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "allowlist entries require expires: YYYY-MM-DD")
});

const PolicyFile = z
  .object({
    failOn: z.array(z.enum(VERDICTS)).optional(),
    warnOn: z.array(z.enum(VERDICTS)).optional(),
    minCorroborations: z.number().int().nonnegative().optional(),
    allow: z.array(AllowEntry).optional()
  })
  .strict();

export interface Policy {
  failOn: Verdict[];
  warnOn: Verdict[];
  minCorroborations: number;
  allow: z.infer<typeof AllowEntry>[];
  /** Expired allowlist entries and similar notes, printed as warnings. */
  notes: string[];
  source: string;
}

export type FailOnLevel = "divergent" | "under-quorum" | "unattested";

/** `--fail-on` as a severity threshold. UNKNOWN always fails: the gate fails closed. */
export function failOnFromLevel(level: FailOnLevel): Verdict[] {
  const divergent: Verdict[] = ["DIVERGENT", "CONTESTED", "UNKNOWN"];
  if (level === "divergent") return divergent;
  if (level === "under-quorum") return [...divergent, "UNDER_QUORUM"];
  return [...divergent, "UNDER_QUORUM", "UNATTESTED"];
}

export const DEFAULT_POLICY: Omit<Policy, "notes" | "source"> = {
  failOn: failOnFromLevel("under-quorum"),
  warnOn: ["UNATTESTED"],
  minCorroborations: 0,
  allow: []
};

/**
 * Load `cairn.policy.json` (explicit path, else ./cairn.policy.json, else defaults).
 * `--fail-on` overrides the file's failOn. Expired allowlist entries are dropped with a
 * warning — permanent silent exceptions are how security tools die.
 */
export function loadPolicy(opts: { path?: string | undefined; failOn?: FailOnLevel | undefined; today?: Date }): Policy {
  const explicit = opts.path !== undefined;
  const path = opts.path ?? "cairn.policy.json";
  let base = { ...DEFAULT_POLICY };
  let source = "built-in defaults";
  if (existsSync(path)) {
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(path, "utf8"));
    } catch (cause) {
      throw new ConfigError(`policy file ${path} is not valid JSON`, { cause });
    }
    const parsed = PolicyFile.safeParse(json);
    if (!parsed.success) {
      throw new ConfigError(`invalid policy file ${path}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    }
    base = {
      failOn: parsed.data.failOn ?? base.failOn,
      warnOn: parsed.data.warnOn ?? base.warnOn,
      minCorroborations: parsed.data.minCorroborations ?? base.minCorroborations,
      allow: parsed.data.allow ?? []
    };
    source = path;
  } else if (explicit) {
    throw new ConfigError(`policy file not found: ${path}`);
  }

  const failOn = opts.failOn !== undefined ? failOnFromLevel(opts.failOn) : base.failOn;
  // Fail closed regardless of what a policy file says.
  if (!failOn.includes("UNKNOWN")) failOn.push("UNKNOWN");

  const today = (opts.today ?? new Date()).toISOString().slice(0, 10);
  const notes: string[] = [];
  const allow = base.allow.filter((a) => {
    if (a.expires < today) {
      notes.push(`allowlist entry for ${a.name}@${a.version} expired on ${a.expires} and is ignored`);
      return false;
    }
    return true;
  });
  return { ...base, failOn, allow, notes, source };
}

export function allowEntryFor(policy: Policy, name: string, version: string) {
  return policy.allow.find((a) => a.name === name && (a.version === version || a.version === "*"));
}
