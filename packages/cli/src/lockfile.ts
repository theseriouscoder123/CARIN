// The lockfile parser lives in @cairn/core so the CLI and the dashboard share one
// implementation (the same rule as the digest: no second copy to drift).
export { LockfileError, parseLockfile, type LockedDependency } from "@cairn/core";
