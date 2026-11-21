// `pnpm attesters:up` — launch three attesters as three separate OS processes, each with
// its own key, label, port and state directory (SPEC-ATTESTER §7). Local chains only:
// the keys are Hardhat's published dev accounts #2-#4 and must never touch a real chain.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const rpcUrl = process.env.CAIRN_RPC_URL ?? "http://127.0.0.1:8545";
// `--registry <url>` points all three at one npm registry (e.g. the local demo Verdaccio).
const regFlag = process.argv.indexOf("--registry");
const npmRegistry = regFlag !== -1 ? process.argv[regFlag + 1] : process.env.CAIRN_NPM_REGISTRY;
const host = new URL(rpcUrl).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.error(`attesters:up uses public dev keys and only runs against a local chain (got ${rpcUrl}).`);
  console.error("For a real chain, start each attester yourself with its own CAIRN_ATTESTER_KEY.");
  process.exit(2);
}

const ATTESTERS = [
  { label: "attester-a", port: 4001, color: 36, key: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" },
  { label: "attester-b", port: 4002, color: 35, key: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" },
  { label: "attester-c", port: 4003, color: 33, key: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" }
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
