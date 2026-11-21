// Test-only ustar writer. Deliberately independent of src/tar.ts so fixtures built here
// exercise the reader rather than round-tripping one implementation through itself.
import { gzipSync } from "node:zlib";

export interface WriteEntry {
  path: string;
  /** '0' file (default), '1' hardlink, '2' symlink, '5' directory, '3' char device */
  type?: "0" | "1" | "2" | "3" | "5" | "7";
  data?: Uint8Array | string;
  mode?: number;
  mtime?: number;
  uid?: number;
  gid?: number;
  uname?: string;
  gname?: string;
  linkname?: string;
}

export interface WriteOptions {
  gzip?: boolean;
  level?: number;
  /** Use a pax `x` header for every path (exercises the pax code path). */
  pax?: boolean;
}

const enc = new TextEncoder();

function writeString(block: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = enc.encode(value);
  if (bytes.length > length) throw new RangeError(`field overflow: ${value}`);
  block.set(bytes, offset);
}

function writeOctal(block: Uint8Array, offset: number, length: number, value: number): void {
  writeString(block, offset, length, value.toString(8).padStart(length - 1, "0") + "\0");
}

function header(entry: Required<Omit<WriteEntry, "data">> & { size: number }): Uint8Array {
  const block = new Uint8Array(512);
  let name = entry.path;
  let prefix = "";
  if (enc.encode(name).length > 100) {
    const cut = name.lastIndexOf("/", 155);
    prefix = name.slice(0, cut);
    name = name.slice(cut + 1);
  }
  writeString(block, 0, 100, name);
  writeOctal(block, 100, 8, entry.mode);
  writeOctal(block, 108, 8, entry.uid);
  writeOctal(block, 116, 8, entry.gid);
  writeOctal(block, 124, 12, entry.size);
  writeOctal(block, 136, 12, entry.mtime);
  block.fill(0x20, 148, 156);
  writeString(block, 156, 1, entry.type);
  writeString(block, 157, 100, entry.linkname);
  writeString(block, 257, 6, "ustar\0");
  writeString(block, 263, 2, "00");
  writeString(block, 265, 32, entry.uname);
  writeString(block, 297, 32, entry.gname);
  writeString(block, 345, 155, prefix);
  let sum = 0;
  for (const b of block) sum += b;
  writeString(block, 148, 8, sum.toString(8).padStart(6, "0") + "\0 ");
  return block;
}

function pad(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(data.length / 512) * 512);
  out.set(data);
  return out;
}

function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let len = body.length + 1;
  while (String(len).length + enc.encode(body).length !== len) len = String(len).length + enc.encode(body).length;
  return `${len}${body}`;
}

export function writeTar(entries: WriteEntry[], options: WriteOptions = {}): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const e of entries) {
    const type = e.type ?? "0";
    const data = typeof e.data === "string" ? enc.encode(e.data) : (e.data ?? new Uint8Array());
    const base = {
      type,
      mode: e.mode ?? (type === "5" ? 0o755 : 0o644),
      mtime: e.mtime ?? 499162500,
      uid: e.uid ?? 0,
      gid: e.gid ?? 0,
      uname: e.uname ?? "",
      gname: e.gname ?? "",
      linkname: e.linkname ?? ""
    };
    let path = e.path;
    if (options.pax) {
      const pax = enc.encode(paxRecord("path", e.path));
      chunks.push(header({ ...base, path: "PaxHeader", type: "x" as never, linkname: "", size: pax.length }));
      chunks.push(pad(pax));
      path = "placeholder-overridden-by-pax";
    }
    const size = type === "0" || type === "7" ? data.length : 0;
    chunks.push(header({ ...base, path, size }));
    if (size > 0) chunks.push(pad(data));
  }
  chunks.push(new Uint8Array(1024));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const tar = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    tar.set(c, off);
    off += c.length;
  }
  return options.gzip === false ? tar : gzipSync(tar, { level: options.level ?? 9 });
}
