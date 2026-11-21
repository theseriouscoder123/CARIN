// Launch three attesters as three separate OS processes, each with its own key, label,
// port and state directory (SPEC-ATTESTER §7).
//
//   pnpm attesters:up              local chain, Hardhat's published dev keys #2-#4
//   pnpm attesters:base-sepolia    --keys <file>: keys generated locally (never committed)
//
// Flags: --registry <npm url>, --rpc <url>, --keys <env file>.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const npmRegistry = flag("--registry") ?? process.env.CAIRN_NPM_REGISTRY;
const keysFile = flag("--keys");
const rpcUrl = flag("--rpc") ?? process.env.CAIRN_RPC_URL ?? "http://127.0.0.1:8545";

const LOCAL_DEV_KEYS = [
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"
];

let keys;
if (keysFile) {
  if (!existsSync(keysFile)) {
    console.error(`keys file not found: ${keysFile}`);
    process.exit(2);
  }
  const env = Object.fromEntries(
    readFileSync(keysFile, "utf8")
      .split(/\r?\n/)
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])
  );
  keys = ["CAIRN_ATTESTER_A_KEY", "CAIRN_ATTESTER_B_KEY", "CAIRN_ATTESTER_C_KEY"].map((k) => env[k]);
  if (keys.some((k) => !k)) {
    console.error(`${keysFile} must define CAIRN_ATTESTER_A_KEY, _B_KEY and _C_KEY`);
    process.exit(2);
  }
} else {
  // The built-in keys are public: refuse anything but a local chain.
  if (!["127.0.0.1", "localhost", "::1"].includes(new URL(rpcUrl).hostname)) {
    console.error(`the built-in dev keys only run against a local chain (got ${rpcUrl}); pass --keys <file>.`);
    process.exit(2);
  }
  keys = LOCAL_DEV_KEYS;
}

const ATTESTERS = [
  { label: "attester-a", port: 4001, color: 36, key: keys[0] },
  { label: "attester-b", port: 4002, color: 35, key: keys[1] },
  { label: "attester-c", port: 4003, color: 33, key: keys[2] }
];

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const children = ATTESTERS.map((a) => {
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      CAIRN_RPC_URL: rpcUrl,
      ...(npmRegistry ? { CAIRN_NPM_REGISTRY: npmRegistry } : {}),
      CAIRN_ATTESTER_LABEL: a.label,
      CAIRN_ATTESTER_KEY: a.key,
      PORT: String(a.port),
      CAIRN_RECHECK_INTERVAL: process.env.CAIRN_RECHECK_INTERVAL ?? "60"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const tag = process.stdout.isTTY ? `\u001b[${a.color}m${a.label}\u001b[0m` : a.label;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) if (line.trim() !== "") out.write(`${tag} │ ${line.replace(/^\[[^\]]+\] /, "")}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => console.log(`${tag} │ exited with code ${code} (pid ${child.pid})`));
  console.log(`${tag} │ pid ${child.pid} · port ${a.port}`);
  return child;
});

const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
