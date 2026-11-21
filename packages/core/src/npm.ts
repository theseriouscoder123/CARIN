import { z } from "zod";
import { ManifestError, RegistryError } from "./errors.js";
import type { Ecosystem } from "./identity.js";
import { readTar } from "./tar.js";

export const DEFAULT_NPM_REGISTRY = "https://registry.npmjs.org";

/** A resolved, fetchable artifact. */
export interface ArtifactRef {
  ecosystem: Ecosystem;
  name: string;
  version: string;
  tarballUrl: string;
  /** Registry-reported integrity. Informational only — never trusted for a verdict. */
  integrity?: string | undefined;
}

/** Ecosystem-specific behaviour lives behind this interface (ARCHITECTURE §4.2). */
export interface RegistryAdapter {
  readonly ecosystem: Ecosystem;
  resolve(name: string, version: string): Promise<ArtifactRef>;
  fetch(ref: ArtifactRef): Promise<Uint8Array>;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

const VersionDoc = z.object({
  name: z.string(),
  version: z.string(),
  dist: z.object({
    tarball: z.string().url(),
    integrity: z.string().optional(),
    shasum: z.string().optional()
  })
});

const MAX_TARBALL_BYTES = 256 * 1024 * 1024;

/** Registry path segment for a (possibly scoped) name: `@scope/pkg` → `@scope%2fpkg`. */
export function encodePackageName(name: string): string {
  return name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
}

export class NpmAdapter implements RegistryAdapter {
  readonly ecosystem = "npm" as const;
  readonly registryUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(opts: { registryUrl?: string; fetch?: FetchLike; timeoutMs?: number } = {}) {
    this.registryUrl = (opts.registryUrl ?? DEFAULT_NPM_REGISTRY).replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async resolve(name: string, version: string): Promise<ArtifactRef> {
    const url = `${this.registryUrl}/${encodePackageName(name)}/${encodeURIComponent(version)}`;
    let res;
    try {
      res = await this.fetchImpl(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { accept: "application/json" }
      });
    } catch (cause) {
      throw new RegistryError(`registry unreachable: ${url}`, { cause });
    }
    if (!res.ok) throw new RegistryError(`registry returned ${res.status} for ${name}@${version}`, { status: res.status });
    const parsed = VersionDoc.safeParse(await res.json());
    if (!parsed.success) throw new RegistryError(`unexpected registry response for ${name}@${version}`);
    if (parsed.data.name !== name || parsed.data.version !== version) {
      throw new RegistryError(
        `registry answered ${parsed.data.name}@${parsed.data.version} when asked for ${name}@${version}`
      );
    }
    return {
      ecosystem: "npm",
      name,
      version,
      tarballUrl: parsed.data.dist.tarball,
      integrity: parsed.data.dist.integrity
    };
  }

  /** Fetch the tarball bytes exactly as served. */
  async fetch(ref: ArtifactRef): Promise<Uint8Array> {
    return this.fetchUrl(ref.tarballUrl);
  }

  async fetchUrl(url: string): Promise<Uint8Array> {
    let res;
    try {
      res = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (cause) {
      throw new RegistryError(`tarball fetch failed: ${url}`, { cause });
    }
    if (!res.ok) throw new RegistryError(`tarball fetch returned ${res.status}: ${url}`, { status: res.status });
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > MAX_TARBALL_BYTES) throw new RegistryError(`tarball exceeds size limit: ${url}`);
    return buf;
  }
}

const Manifest = z.object({ name: z.string().min(1), version: z.string().min(1) });

/**
 * Read `name` and `version` from the package.json at the artifact root. Used by
 * `cairn publish <tarball>` so the identity comes from the artifact itself.
 */
export function readPackageManifest(tarball: Uint8Array): { name: string; version: string } {
  const files = readTar(tarball).filter((e) => e.type === "file");
  const candidates = files
    .map((e) => ({ e, parts: e.path.replace(/\\/g, "/").split("/").filter((p) => p !== "" && p !== ".") }))
    .filter(({ parts }) => parts[parts.length - 1] === "package.json" && parts.length <= 2)
    .sort((a, b) => a.parts.length - b.parts.length);
  const hit = candidates[0];
  if (hit === undefined) throw new ManifestError("no package.json at the artifact root");
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(hit.e.data));
  } catch (cause) {
    throw new ManifestError("package.json is not valid JSON", { cause });
  }
  const parsed = Manifest.safeParse(json);
  if (!parsed.success) throw new ManifestError("package.json lacks a name or version");
  return parsed.data;
}
