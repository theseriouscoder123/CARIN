import { CairnError } from "./errors.js";
import { z } from "zod";

/** Lockfile is unusable: v1, malformed, or not an npm lockfile. Exit code 2. */
export class LockfileError extends CairnError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("LOCKFILE", message, options);
  }
}

export interface LockedDependency {
  name: string;
  version: string;
  /** Exactly what `npm ci` would download. */
  resolved: string;
  integrity?: string | undefined;
  /** Every `node_modules/...` path this name@version occupies. */
  paths: string[];
  /** false for git/file/link sources, which no registry attestation can cover. */
  registrySource: boolean;
}

const Entry = z
  .object({
    name: z.string().optional(),
    version: z.string().optional(),
    resolved: z.string().optional(),
    integrity: z.string().optional(),
    link: z.boolean().optional()
  })
  .passthrough();

const Lockfile = z
  .object({
    lockfileVersion: z.number().int(),
    packages: z.record(z.string(), Entry).optional()
  })
  .passthrough();

/** `node_modules/a/node_modules/@s/b` → `@s/b` */
function nameFromPath(path: string): string | undefined {
  const idx = path.lastIndexOf("node_modules/");
  if (idx === -1) return undefined;
  return path.slice(idx + "node_modules/".length);
}

/**
 * Parse an npm `package-lock.json` (v2 or v3) into the set of artifacts `npm ci` would
 * fetch. Walks the `packages` map, never the legacy `dependencies` tree; v1 is rejected
 * rather than guessed at (CLAUDE.md §7).
 */
export function parseLockfile(text: string): LockedDependency[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    throw new LockfileError("lockfile is not valid JSON", { cause });
  }
  const parsed = Lockfile.safeParse(json);
  if (!parsed.success) throw new LockfileError("not an npm package-lock.json (no lockfileVersion)");
  const { lockfileVersion, packages } = parsed.data;
  if (lockfileVersion === 1) {
    throw new LockfileError(
      "lockfileVersion 1 is not supported — regenerate it with npm >= 7 (`npm install --package-lock-only`)"
    );
  }
  if (lockfileVersion !== 2 && lockfileVersion !== 3) {
    throw new LockfileError(`unsupported lockfileVersion ${lockfileVersion}`);
  }
  if (packages === undefined) throw new LockfileError("lockfile has no `packages` map");

  const byKey = new Map<string, LockedDependency>();
  for (const [path, entry] of Object.entries(packages)) {
    if (path === "") continue; // the root project
    if (entry.link === true) continue; // workspace symlink, nothing is fetched
    if (entry.resolved === undefined) continue; // bundled inside a parent tarball
    // `name` is present for aliased installs (npm:real@x); otherwise derive from the path.
    const name = entry.name ?? nameFromPath(path);
    if (name === undefined || entry.version === undefined) {
      throw new LockfileError(`lockfile entry ${JSON.stringify(path)} has no name or version`);
    }
    const key = `${name}@${entry.version}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.paths.push(path);
      continue;
    }
    byKey.set(key, {
      name,
      version: entry.version,
      resolved: entry.resolved,
      integrity: entry.integrity,
      paths: [path],
      registrySource: /^https?:\/\//.test(entry.resolved)
    });
  }
  return [...byKey.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
