import { keccak256, stringToBytes, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  ATTESTATION_TYPEHASH,
  ATTESTATION_TYPE_STRING,
  InvalidPackageIdentityError,
  buildAttestationPayload,
  canonicalJson,
  canonicaliseTarball,
  computeArtifactDigest,
  computePayloadDigest,
  computeTarballHash,
  packageId,
  recoverAttestationSigner,
  signAttestation
} from "../src/index.js";
import { writeTar } from "./helpers/tar.js";

describe("packageId", () => {
  it("is keccak256 of 'eco:name@version'", () => {
    expect(packageId("npm", "@cairn-demo/greeting", "1.0.0")).toBe(
      keccak256(stringToBytes("npm:@cairn-demo/greeting@1.0.0"))
    );
  });

  it("accepts prerelease and build metadata verbatim", () => {
    expect(() => packageId("npm", "left-pad", "1.3.0-beta.1+sha.abc")).not.toThrow();
  });

  for (const bad of ["v1.0.0", "^1.0.0", "1.0", "1.0.0 ", "latest", ""]) {
    it(`rejects version ${JSON.stringify(bad)}`, () => {
      expect(() => packageId("npm", "left-pad", bad)).toThrow(InvalidPackageIdentityError);
    });
  }

  it("rejects malformed names", () => {
    expect(() => packageId("npm", "has space", "1.0.0")).toThrow(InvalidPackageIdentityError);
    expect(() => packageId("npm", "@scope/", "1.0.0")).toThrow(InvalidPackageIdentityError);
  });
});

describe("canonicalJson", () => {
  it("sorts keys recursively and strips whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}'
    );
  });

  it("is invariant to key insertion order", () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalJson({ n: Number.NaN })).toThrow();
  });
});

describe("attestation payload", () => {
  const bytes = writeTar([{ path: "package/index.js", data: "1" }]);
  const tree = canonicaliseTarball(bytes);
  const base = {
    ecosystem: "npm" as const,
    name: "x",
    version: "1.0.0",
    tree,
    artifactDigest: computeArtifactDigest(tree),
    tarballHash: computeTarballHash(bytes),
    publisher: zeroAddress,
    producedAt: new Date("2026-11-21T10:00:00Z")
  };

  it("records spec, tool version and entry count", () => {
    const p = buildAttestationPayload(base);
    expect(p).toMatchObject({ schema: "cairn.attestation.v1", digestSpec: "cairn-merkle-v1", entryCount: 1 });
  });

  it("payloadDigest is stable and changes with content", () => {
    const d1 = computePayloadDigest(buildAttestationPayload(base));
    expect(computePayloadDigest(buildAttestationPayload(base))).toBe(d1);
    expect(computePayloadDigest(buildAttestationPayload({ ...base, version: "1.0.1" }))).not.toBe(d1);
  });
});

describe("EIP-712", () => {
  // Hardhat's well-known dev account #0 — a public test key, never used outside tests.
  const account = privateKeyToAccount(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  );
  const contract = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
  const message = {
    ecosystem: "npm",
    name: "x",
    version: "1.0.0",
    artifactDigest: `0x${"11".repeat(32)}` as const,
    tarballHash: `0x${"22".repeat(32)}` as const,
    payloadDigest: `0x${"33".repeat(32)}` as const,
    nonce: 0n
  };

  it("typehash is keccak256 of the canonical type string", () => {
    expect(ATTESTATION_TYPEHASH).toBe(keccak256(stringToBytes(ATTESTATION_TYPE_STRING)));
  });

  it("sign → recover round-trips to the signer", async () => {
    const sig = await signAttestation(account, 31337, contract, message);
    expect(await recoverAttestationSigner(31337, contract, message, sig)).toBe(account.address);
  });

  it("a signature does not verify for a different chain or message", async () => {
    const sig = await signAttestation(account, 31337, contract, message);
    expect(await recoverAttestationSigner(1, contract, message, sig)).not.toBe(account.address);
    expect(
      await recoverAttestationSigner(31337, contract, { ...message, version: "1.0.1" }, sig)
    ).not.toBe(account.address);
  });
});
