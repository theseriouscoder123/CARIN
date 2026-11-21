import { gunzipSync } from "node:zlib";
import { ArchiveFormatError } from "./errors.js";

/**
 * Minimal, dependency-free tar reader. Handles ustar (with `prefix`), GNU long names
 * (`L` / `K`) and pax extended headers (`x`), which together cover everything npm and
 * common packers emit. Written in-house deliberately: one less third-party package in
 * the code path that decides whether a dependency is trustworthy.
 */

const BLOCK = 512;
/** Upper bound on decompressed size; guards against gzip bombs. */
const MAX_INFLATED_BYTES = 1024 * 1024 * 1024;

export type TarEntryType = "file" | "directory" | "symlink" | "hardlink" | "other";

export interface TarEntry {
  /** Raw path as recorded in the archive (after pax / GNU / ustar-prefix resolution). */
  path: string;
  type: TarEntryType;
  /** The raw tar typeflag character, for diagnostics. */
  typeflag: string;
  mode: number;
  /** Link target for symlinks and hardlinks; empty otherwise. */
  linkname: string;
  /** Entry body. Empty for non-file entries. A view into the inflated buffer. */
  data: Uint8Array;
}

const decoder = new TextDecoder("utf-8", { fatal: false });

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Gunzip when the input carries the gzip magic; pass raw tar through untouched. */
export function inflate(bytes: Uint8Array): Uint8Array {
  if (!isGzip(bytes)) return bytes;
  try {
    return gunzipSync(bytes, { maxOutputLength: MAX_INFLATED_BYTES });
  } catch (cause) {
    throw new ArchiveFormatError("gzip stream could not be decompressed", { cause });
  }
}

function readString(block: Uint8Array, offset: number, length: number): string {
  const field = block.subarray(offset, offset + length);
  const nul = field.indexOf(0);
  return decoder.decode(nul === -1 ? field : field.subarray(0, nul));
}

function readNumber(block: Uint8Array, offset: number, length: number): number {
  const field = block.subarray(offset, offset + length);
  // GNU base-256 encoding: high bit of the first byte set.
  if (field.length > 0 && ((field[0] ?? 0) & 0x80) !== 0) {
    let value = (field[0] ?? 0) & 0x7f;
    for (let i = 1; i < field.length; i++) value = value * 256 + (field[i] ?? 0);
    return value;
  }
  const text = readString(block, offset, length).trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) {
    throw new ArchiveFormatError(`invalid octal field ${JSON.stringify(text)}`);
  }
  return parseInt(text, 8);
}

function isZeroBlock(block: Uint8Array): boolean {
  for (const byte of block) if (byte !== 0) return false;
  return true;
}

function verifyChecksum(block: Uint8Array): void {
  const expected = readNumber(block, 148, 8);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : (block[i] ?? 0);
  if (sum !== expected) {
    throw new ArchiveFormatError(`tar header checksum mismatch (expected ${expected}, got ${sum})`);
  }
}

/** Parse pax extended header records: `"<len> <key>=<value>\n"` repeated. */
function parsePax(data: Uint8Array): Map<string, string> {
  const records = new Map<string, string>();
  let pos = 0;
  while (pos < data.length) {
    const space = data.indexOf(0x20, pos);
    if (space === -1) break;
    const len = parseInt(decoder.decode(data.subarray(pos, space)), 10);
    if (!Number.isFinite(len) || len <= 0 || pos + len > data.length) {
      throw new ArchiveFormatError("malformed pax extended header");
    }
    const record = decoder.decode(data.subarray(space + 1, pos + len - 1)); // drop trailing \n
    const eq = record.indexOf("=");
    if (eq > 0) records.set(record.slice(0, eq), record.slice(eq + 1));
    pos += len;
  }
  return records;
}

function classify(typeflag: string): TarEntryType {
  switch (typeflag) {
    case "0":
    case "\0":
    case "":
    // '7' (contiguous file) is a regular file to every extractor, node-tar included.
    // Excluding it would hand an attacker an invisible file slot.
    case "7":
      return "file";
    case "5":
      return "directory";
    case "2":
      return "symlink";
    case "1":
      return "hardlink";
    default:
      return "other";
  }
}

/** Parse a (possibly gzipped) tar archive into its entries, in archive order. */
export function readTar(input: Uint8Array): TarEntry[] {
  const bytes = inflate(input);
  const entries: TarEntry[] = [];

  let offset = 0;
  let pendingPax = new Map<string, string>();
  let pendingLongName: string | undefined;
  let pendingLongLink: string | undefined;

  while (offset + BLOCK <= bytes.length) {
    const header = bytes.subarray(offset, offset + BLOCK);
    if (isZeroBlock(header)) break; // end-of-archive marker
    verifyChecksum(header);

    const typeflag = String.fromCharCode(header[156] ?? 0);
    let size = readNumber(header, 124, 12);
    if (pendingPax.has("size")) size = Number(pendingPax.get("size"));

    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (!Number.isSafeInteger(size) || size < 0 || dataEnd > bytes.length) {
      throw new ArchiveFormatError("tar entry extends past end of archive");
    }
    const data = bytes.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    // Meta-entries modify the *next* real entry.
    if (typeflag === "x") {
      pendingPax = parsePax(data);
      continue;
    }
    if (typeflag === "g") continue; // global pax header: no per-entry semantics we rely on
    if (typeflag === "L") {
      pendingLongName = readString(data, 0, data.length);
      continue;
    }
    if (typeflag === "K") {
      pendingLongLink = readString(data, 0, data.length);
      continue;
    }

    let path = readString(header, 0, 100);
    const magic = readString(header, 257, 6);
    if (magic.startsWith("ustar")) {
      const prefix = readString(header, 345, 155);
      if (prefix !== "") path = `${prefix}/${path}`;
    }
    if (pendingLongName !== undefined) path = pendingLongName;
    if (pendingPax.has("path")) path = pendingPax.get("path") ?? path;

    let linkname = readString(header, 157, 100);
    if (pendingLongLink !== undefined) linkname = pendingLongLink;
    if (pendingPax.has("linkpath")) linkname = pendingPax.get("linkpath") ?? linkname;

    const type = classify(typeflag);
    entries.push({
      path,
      type,
      typeflag,
      mode: readNumber(header, 100, 8),
      linkname,
      data: type === "file" ? data : new Uint8Array(0)
    });

    pendingPax = new Map();
    pendingLongName = undefined;
    pendingLongLink = undefined;
  }

  return entries;
}
