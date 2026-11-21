import { keccak256, stringToBytes, type Hex } from "viem";
import { InvalidPackageIdentityError } from "./errors.js";

export type Ecosystem = "npm";
export const SUPPORTED_ECOSYSTEMS: readonly Ecosystem[] = ["npm"];

// semver.org recommended regex (exact version, no ranges, no leading "v").
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

// npm names: optional @scope/, lowercase-ish URL-safe chars. Kept permissive on case
// because legacy packages exist with capitals; the registry name is used verbatim.
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[A-Za-z0-9][A-Za-z0-9._~-]*$/;

/** The exact string hashed into a packageId: `${ecosystem}:${name}@${version}`. */
export function packageKey(ecosystem: Ecosystem, name: string, version: string): string {
  if (!SUPPORTED_ECOSYSTEMS.includes(ecosystem)) {
    throw new InvalidPackageIdentityError(`unsupported ecosystem ${JSON.stringify(ecosystem)}`);
  }
  if (!NPM_NAME.test(name)) {
    throw new InvalidPackageIdentityError(`invalid npm package name ${JSON.stringify(name)}`);
  }
  if (!SEMVER.test(version)) {
    throw new InvalidPackageIdentityError(
      `version must be an exact semver string, got ${JSON.stringify(version)}`
    );
  }
  return `${ecosystem}:${name}@${version}`;
}

/**
 * `packageId = keccak256(utf8("eco:name@version"))` (SPEC-DIGEST §5). Matches the
 * contract's `keccak256(abi.encodePacked(ecosystem, ":", name, "@", version))`.
 */
export function packageId(ecosystem: Ecosystem, name: string, version: string): Hex {
  return keccak256(stringToBytes(packageKey(ecosystem, name, version)));
}
