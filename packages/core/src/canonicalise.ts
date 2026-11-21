import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { join } from "node:path";
import type { Hex } from "viem";
import { DuplicatePathError, EmptyArtifactError, PathTraversalError } from "./errors.js";
import { sha256, toHex32 } from "./hash.js";
import { readTar } from "./tar.js";

/** One digestible entry of a normalised artifact (SPEC-DIGEST §3.4). */
export interface CanonicalEntry {
  /** Normalised: NFC, `/`-separated, root wrapper stripped, no `./`. */
  path: string;
  kind: "file" | "symlink";
  /** 1 if any execute bit is set, else 0. Symlinks are always 0. */
  modeClass: 0 | 1;
  /** sha256 of raw bytes (file) or of the UTF-8 link target (symlink). */
  contentHash: Hex;
  /** Informational only; NOT part of the digest. */
  size: number;
}

export interface CanonicalTree {
  /** Sorted by UTF-8 byte order of `path`. */
  entries: CanonicalEntry[];
  warnings: string[];
}

export type TarballSource =
  | { kind: "tarball"; bytes: Uint8Array }
  | { kind: "directory"; path: string };

/** An entry before path normalisation and root stripping. */
interface RawEntry {
  rawPath: string;
  kind: "file" | "symlink";
  mode: number;
  content: Uint8Array;
}

const utf8 = new TextEncoder();

/** Byte-wise UTF-8 comparison. Never `localeCompare`, never JS `<` (UTF-16 order). */
export function compareUtf8(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Validate and split a raw archive path into components. Rejects traversal attempts
 * outright: these are attacks, not packaging quirks (SPEC-DIGEST §3.1).
 */
function splitSafePath(raw: string): string[] {
  if (raw.includes("\0")) throw new PathTraversalError(raw);
  const slashed = raw.replace(/\\/g, "/");
  if (slashed.startsWith("/") || /^[A-Za-z]:/.test(slashed)) throw new PathTraversalError(raw);
  const parts = slashed.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === "..")) throw new PathTraversalError(raw);
  return parts.map((p) => p.normalize("NFC"));
}

/**
 * The single wrapping root component shared by every entry, if any. npm wraps in
 * `package/`, but some packers use the package name; strip whichever wraps everything.
 */
function commonRoot(paths: string[][]): string | undefined {
  const first = paths[0]?.[0];
  if (first === undefined) return undefined;
  for (const parts of paths) {
    if (parts.length < 2 || parts[0] !== first) return undefined;
  }
  return first;
}

function modeClassOf(kind: RawEntry["kind"], mode: number): 0 | 1 {
  if (kind === "symlink") return 0;
  return (mode & 0o111) !== 0 ? 1 : 0;
}

/** Shared tail of both sources: normalise paths, strip root, hash, sort, dedupe. */
function buildTree(raw: RawEntry[], warnings: string[]): CanonicalTree {
  if (raw.length === 0) throw new EmptyArtifactError();

  const split = raw.map((e) => splitSafePath(e.rawPath));
  const root = commonRoot(split);

  const entries: CanonicalEntry[] = raw.map((e, i) => {
    const parts = split[i] ?? [];
    const path = (root === undefined ? parts : parts.slice(1)).join("/");
    if (path === "") throw new PathTraversalError(e.rawPath);
    return {
      path,
      kind: e.kind,
      modeClass: modeClassOf(e.kind, e.mode),
      contentHash: toHex32(sha256(e.content)),
      size: e.content.length
    };
  });

  entries.sort((a, b) => compareUtf8(a.path, b.path));
  for (let i = 1; i < entries.length; i++) {
    const path = entries[i]?.path;
    if (path !== undefined && path === entries[i - 1]?.path) throw new DuplicatePathError(path);
  }

  return { entries, warnings };
}

/**
 * Canonicalise tarball bytes (gzipped or raw tar). Pure and synchronous given bytes.
 */
export function canonicaliseTarball(bytes: Uint8Array): CanonicalTree {
  const warnings: string[] = [];
  const raw: RawEntry[] = [];

  for (const entry of readTar(bytes)) {
    switch (entry.type) {
      case "file":
        raw.push({ rawPath: entry.path, kind: "file", mode: entry.mode, content: entry.data });
        break;
      case "symlink":
      case "hardlink":
        raw.push({
          rawPath: entry.path,
          kind: "symlink",
          mode: 0,
          content: utf8.encode(entry.linkname)
        });
        break;
      case "directory":
        break; // implied by file paths; packer-dependent, so never hashed
      case "other":
        warnings.push(
          `skipped unsupported tar entry type ${JSON.stringify(entry.typeflag)}: ${entry.path}`
        );
        break;
    }
  }

  return buildTree(raw, warnings);
}

async function walk(dir: string, rel: string, out: RawEntry[], warnings: string[]): Promise<void> {
  const names = await readdir(dir);
  for (const name of names) {
    const abs = join(dir, name);
    const relPath = rel === "" ? name : `${rel}/${name}`;
    const st = await lstat(abs);
    if (st.isDirectory()) {
      await walk(abs, relPath, out, warnings);
    } else if (st.isSymbolicLink()) {
      const target = await readlink(abs);
      out.push({ rawPath: relPath, kind: "symlink", mode: 0, content: utf8.encode(target) });
    } else if (st.isFile()) {
      out.push({ rawPath: relPath, kind: "file", mode: st.mode, content: await readFile(abs) });
    } else {
      warnings.push(`skipped unsupported filesystem entry: ${relPath}`);
    }
  }
}

/**
 * Canonicalise an already-extracted directory. Must produce the same tree as the
 * tarball it came from (tested invariant). Platform caveat: filesystems without POSIX
 * execute bits (Windows) cannot preserve `modeClass`.
 */
export async function canonicaliseDirectory(path: string): Promise<CanonicalTree> {
  const warnings: string[] = [];
  const raw: RawEntry[] = [];
  await walk(path, "", raw, warnings);
  return buildTree(raw, warnings);
}

/** Canonicalise either source kind. */
export async function canonicalise(source: TarballSource): Promise<CanonicalTree> {
  return source.kind === "tarball"
    ? canonicaliseTarball(source.bytes)
    : canonicaliseDirectory(source.path);
}
