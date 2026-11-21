// Tiny ANSI helper — no colour dependency in a supply-chain tool.
export interface Style {
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
  cyan(s: string): string;
}

const wrap = (open: number, close: number) => (s: string) => `\u001b[${open}m${s}\u001b[${close}m`;
const plain = (s: string) => s;

export function createStyle(color: boolean): Style {
  if (!color) return { bold: plain, dim: plain, red: plain, green: plain, yellow: plain, cyan: plain };
  return {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    cyan: wrap(36, 39)
  };
}

/** Respect NO_COLOR, --no-color and non-TTY stdout (SPEC-CLI §6). */
export function shouldColor(flag: boolean | undefined, stream: { isTTY?: boolean } = process.stdout): boolean {
  if (flag === false) return false;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return false;
  return stream.isTTY === true;
}

/** `0x7f3a…c21e` */
export function short(hex: string, head = 4, tail = 4): string {
  if (hex.length <= 2 + head + tail + 1) return hex;
  return `${hex.slice(0, 2 + head)}…${hex.slice(-tail)}`;
}
