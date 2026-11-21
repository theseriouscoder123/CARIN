// pnpm registry:reset — wipe the local demo registry (stop Verdaccio first).
import { rmSync } from "node:fs";
import { STATE } from "./lib.mjs";

rmSync(STATE, { recursive: true, force: true });
console.log(`removed ${STATE}`);
