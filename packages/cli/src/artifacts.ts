import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CairnError, NpmAdapter } from "@cairn/core";

/** Where verify gets artifact bytes from. Faked in tests. */
export interface ArtifactSource {
  fetch(resolved: string, integrity: string | undefined): Promise<{ bytes: Uint8Array; fromCache: boolean }>;
}

/**
 * Check bytes against an SRI string (`sha512-<base64>`, possibly several space-separated).
 * Returns undefined when there is no usable hash to check against.
 */
export function checkIntegrity(bytes: Uint8Array, integrity: string | undefined): boolean | undefined {
  if (integrity === undefined || integrity.trim() === "") return undefined;
  let checked = false;
  for (const token of integrity.trim().split(/\s+/)) {
    const m = /^(sha512|sha384|sha256|sha1)-(.+)$/.exec(token);
    if (!m) continue;
    checked = true;
    const actual = createHash(m[1] as string).update(bytes).digest("base64");
    if (actual === m[2]) return true;
  }
  return checked ? false : undefined;
}

export class OfflineMissError extends CairnError {
  constructor(url: string) {
    super("OFFLINE_MISS", `not in the local cache and --offline was given: ${url}`);
  }
}

/**
 * Fetch tarballs from their `resolved` URL — the bytes `npm ci` would install — with a
 * disk cache at `<cacheDir>/artifacts/`. Only entries with a lockfile integrity are
 * cached, and every cache read is re-checked against that integrity, so a poisoned cache
 * can never stand in for the real artifact.
 */
export class CachingArtifactSource implements ArtifactSource {
  private readonly http: NpmAdapter;

  constructor(
    private readonly cacheDir: string,
    private readonly offline = false
  ) {
    this.http = new NpmAdapter();
  }

  private keyFor(resolved: string, integrity: string): string {
    return createHash("sha256").update(`${resolved}\n${integrity}`).digest("hex");
  }

  async fetch(resolved: string, integrity: string | undefined) {
    const dir = join(this.cacheDir, "artifacts");
    const file = integrity ? join(dir, this.keyFor(resolved, integrity)) : undefined;
    if (file) {
      try {
        const cached = await readFile(file);
        if (checkIntegrity(cached, integrity) === true) return { bytes: cached, fromCache: true };
      } catch {
        // miss
      }
    }
    if (this.offline) throw new OfflineMissError(resolved);
    const bytes = await this.http.fetchUrl(resolved);
    if (file && checkIntegrity(bytes, integrity) === true) {
      await mkdir(dir, { recursive: true });
      await writeFile(`${file}.tmp`, bytes);
      await rename(`${file}.tmp`, file);
    }
    return { bytes, fromCache: false };
  }
}
