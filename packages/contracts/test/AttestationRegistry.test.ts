import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ATTESTATION_TYPEHASH, ATTESTATION_TYPES, cairnDomain, packageId } from "@cairn/core";
import { network } from "hardhat";
import { keccak256, stringToBytes, type Address, type Hex } from "viem";

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const [admin, publisher, attA, attB, attC, outsider] = await viem.getWalletClients();
if (!admin || !publisher || !attA || !attB || !attC || !outsider) throw new Error("need 6 accounts");

const chainId = await publicClient.getChainId();
const h = (byte: string): Hex => `0x${byte.repeat(32)}`;

const RELEASE = {
  ecosystem: "npm",
  name: "@cairn-demo/greeting",
  version: "1.0.0",
  artifactDigest: h("aa"),
  tarballHash: h("bb"),
  payloadDigest: h("cc")
} as const;

async function deploy(threshold = 2) {
  const policy = await viem.deployContract("QuorumPolicy", [
    admin!.account.address,
    [attA!.account.address, attB!.account.address, attC!.account.address],
    threshold
  ]);
  const registry = await viem.deployContract("AttestationRegistry", [policy.address]);
  return { policy, registry };
}

type Registry = Awaited<ReturnType<typeof deploy>>["registry"];
type Release = { -readonly [K in keyof typeof RELEASE]: (typeof RELEASE)[K] extends Hex ? Hex : string };

async function sign(registry: Registry, release: Release, nonce: bigint, signer = publisher!) {
  return signer.signTypedData({
    account: signer.account,
    domain: cairnDomain(chainId, registry.address),
    types: ATTESTATION_TYPES,
    primaryType: "Attestation",
    message: { ...release, nonce }
  });
}

function idOf(r: Release): Hex {
  return packageId("npm", r.name, r.version);
}

async function submit(
  registry: Registry,
  release: Release = { ...RELEASE },
  opts: { nonce?: bigint; signature?: Hex; id?: Hex; publisherAddr?: Address } = {}
) {
  const nonce = opts.nonce ?? (await registry.read.nonceOf([publisher!.account.address]));
  const signature = opts.signature ?? (await sign(registry, release, nonce));
  return registry.write.submit(
    [
      opts.id ?? idOf(release),
      release.ecosystem,
      release.name,
      release.version,
      release.artifactDigest,
      release.tarballHash,
      release.payloadDigest,
      opts.publisherAddr ?? publisher!.account.address,
      nonce,
      signature
    ],
    { account: outsider!.account } // relayed: the submitter is not the publisher
  );
}

const ID = idOf({ ...RELEASE });

describe("parity with @cairn/core", () => {
  it("ATTESTATION_TYPEHASH matches the core constant", async () => {
    const { registry } = await deploy();
    assert.equal(await registry.read.ATTESTATION_TYPEHASH(), ATTESTATION_TYPEHASH);
  });

  it("core packageId matches the contract's keccak(abi.encodePacked(...)) binding", () => {
    assert.equal(ID, keccak256(stringToBytes("npm:@cairn-demo/greeting@1.0.0")));
  });
});

describe("submit", () => {
  it("happy path: record written, event fields correct, nonce incremented", async () => {
    const { registry } = await deploy();
    await viem.assertions.emitWithArgs(submit(registry), registry, "AttestationSubmitted", [
      ID,
      publisher.account.address,
      RELEASE.artifactDigest,
      RELEASE.tarballHash,
      RELEASE.payloadDigest,
      RELEASE.ecosystem,
      RELEASE.name,
      RELEASE.version
    ]);
    const rec = await registry.read.getAttestation([ID]);
    assert.equal(rec.artifactDigest, RELEASE.artifactDigest);
    assert.equal(rec.publisher.toLowerCase(), publisher.account.address.toLowerCase());
    assert.ok(rec.submittedAt > 0n);
    assert.equal(rec.corroborations, 0);
    assert.equal(await registry.read.nonceOf([publisher.account.address]), 1n);
    assert.equal(await registry.read.exists([ID]), true);
  });

  it("duplicate submit reverts AttestationExists", async () => {
    const { registry } = await deploy();
    await submit(registry);
    // a fresh, correctly-signed attempt with a different digest for the same version
    await viem.assertions.revertWithCustomErrorWithArgs(
      submit(registry, { ...RELEASE, artifactDigest: h("dd") }),
      registry,
      "AttestationExists",
      [ID]
    );
  });

  it("tampered signature reverts InvalidSignature", async () => {
    const { registry } = await deploy();
    const sig = await sign(registry, { ...RELEASE }, 0n);
    const tampered = (sig.slice(0, 10) + (sig[10] === "0" ? "1" : "0") + sig.slice(11)) as Hex;
    await viem.assertions.revertWithCustomError(
      submit(registry, { ...RELEASE }, { signature: tampered }),
      registry,
      "InvalidSignature"
    );
  });

  it("signature over different fields reverts InvalidSignature", async () => {
    const { registry } = await deploy();
    const sigForOther = await sign(registry, { ...RELEASE, artifactDigest: h("ee") }, 0n);
    await viem.assertions.revertWithCustomError(
      submit(registry, { ...RELEASE }, { signature: sigForOther }),
      registry,
      "InvalidSignature"
    );
  });

  it("valid signature claimed for a different publisher reverts InvalidSignature", async () => {
    const { registry } = await deploy();
    await viem.assertions.revertWithCustomError(
      submit(registry, { ...RELEASE }, { publisherAddr: outsider.account.address }),
      registry,
      "InvalidSignature"
    );
  });

  it("wrong packageId for the signed strings reverts PackageIdMismatch", async () => {
    const { registry } = await deploy();
    const wrong = packageId("npm", "left-pad", "1.3.0");
    await viem.assertions.revertWithCustomErrorWithArgs(
      submit(registry, { ...RELEASE }, { id: wrong }),
      registry,
      "PackageIdMismatch",
      [wrong, ID]
    );
  });

  it("replayed nonce reverts NonceMismatch", async () => {
    const { registry } = await deploy();
    await submit(registry);
    const next = { ...RELEASE, version: "1.0.1" };
    await viem.assertions.revertWithCustomErrorWithArgs(
      submit(registry, next, { nonce: 0n }),
      registry,
      "NonceMismatch",
      [1n, 0n]
    );
  });

  it("zero digest reverts ZeroDigest", async () => {
    const { registry } = await deploy();
    await viem.assertions.revertWithCustomError(
      submit(registry, { ...RELEASE, artifactDigest: h("00") }),
      registry,
      "ZeroDigest"
    );
  });
});

describe("corroborate", () => {
  async function attested(threshold = 2) {
    const d = await deploy(threshold);
    await submit(d.registry);
    return d;
  }
  const as = (w: typeof attA) => ({ account: w.account });

  it("non-attester reverts NotAnAttester", async () => {
    const { registry } = await attested();
    await viem.assertions.revertWithCustomErrorWithArgs(
      registry.write.corroborate([ID, RELEASE.artifactDigest], as(outsider)),
      registry,
      "NotAnAttester",
      [outsider.account.address]
    );
  });

  it("missing attestation reverts AttestationMissing", async () => {
    const { registry } = await deploy();
    await viem.assertions.revertWithCustomErrorWithArgs(
      registry.write.corroborate([ID, RELEASE.artifactDigest], as(attA)),
      registry,
      "AttestationMissing",
      [ID]
    );
  });

  it("publisher cannot corroborate its own attestation", async () => {
    const { policy, registry } = await deploy();
    await policy.write.addAttester([publisher.account.address], { account: admin.account });
    await submit(registry);
    await viem.assertions.revertWithCustomError(
      registry.write.corroborate([ID, RELEASE.artifactDigest], as(publisher)),
      registry,
      "PublisherCannotCorroborate"
    );
  });

  it("double corroboration reverts AlreadyCorroborated", async () => {
    const { registry } = await attested();
    await registry.write.corroborate([ID, RELEASE.artifactDigest], as(attA));
    await viem.assertions.revertWithCustomErrorWithArgs(
      registry.write.corroborate([ID, RELEASE.artifactDigest], as(attA)),
      registry,
      "AlreadyCorroborated",
      [ID, attA.account.address]
    );
  });

  it("quorum flips at exactly M and the event carries quorumReached", async () => {
    const { registry } = await attested(2);
    await viem.assertions.emitWithArgs(
      registry.write.corroborate([ID, RELEASE.artifactDigest], as(attA)),
      registry,
      "AttesterCorroborated",
      [ID, attA.account.address, 1, false]
    );
    assert.equal(await registry.read.hasQuorum([ID]), false);
    await viem.assertions.emitWithArgs(
      registry.write.corroborate([ID, RELEASE.artifactDigest], as(attB)),
      registry,
      "AttesterCorroborated",
      [ID, attB.account.address, 2, true]
    );
    assert.equal(await registry.read.hasQuorum([ID]), true);
  });

  it("divergence is recorded, not reverted, and does not count as corroboration", async () => {
    const { registry } = await attested();
    await viem.assertions.emitWithArgs(
      registry.write.corroborate([ID, h("ee")], as(attA)),
      registry,
      "DivergenceReported",
      [ID, attA.account.address, RELEASE.artifactDigest, h("ee")]
    );
    const divs = await registry.read.getDivergences([ID]);
    assert.equal(divs.length, 1);
    assert.equal(divs[0]?.observedDigest, h("ee"));
    assert.equal((await registry.read.getAttestation([ID])).corroborations, 0);
  });

  it("divergence poisons quorum even with M corroborations", async () => {
    const { registry } = await attested(2);
    await registry.write.corroborate([ID, RELEASE.artifactDigest], as(attA));
    await registry.write.corroborate([ID, RELEASE.artifactDigest], as(attB));
    assert.equal(await registry.read.hasQuorum([ID]), true);
    await registry.write.corroborate([ID, h("ee")], as(attC));
    assert.equal(await registry.read.hasQuorum([ID]), false);
  });

  it("an attester that corroborated can later report a divergence (republication)", async () => {
    const { registry } = await attested(2);
    await registry.write.corroborate([ID, RELEASE.artifactDigest], as(attA));
    await registry.write.corroborate([ID, RELEASE.artifactDigest], as(attB));
    await registry.write.corroborate([ID, h("ee")], as(attA));
    assert.equal(await registry.read.hasQuorum([ID]), false);
    await viem.assertions.revertWithCustomError(
      registry.write.corroborate([ID, h("ff")], as(attA)),
      registry,
      "DivergenceAlreadyReported"
    );
  });

  it("removing an attester after it corroborated leaves the record unchanged", async () => {
    const { policy, registry } = await attested(2);
    await registry.write.corroborate([ID, RELEASE.artifactDigest], as(attA));
    await registry.write.corroborate([ID, RELEASE.artifactDigest], as(attB));
    const before = await registry.read.getAttestation([ID]);
    await policy.write.removeAttester([attA.account.address], { account: admin.account });
    const after = await registry.read.getAttestation([ID]);
    assert.deepEqual(after, before);
    assert.equal(await registry.read.hasCorroborated([ID, attA.account.address]), true);
    assert.equal(await registry.read.hasQuorum([ID]), true);
  });
});

describe("QuorumPolicy", () => {
  it("only the admin can change the attester set", async () => {
    const { policy } = await deploy();
    await viem.assertions.revertWithCustomError(
      policy.write.addAttester([outsider.account.address], { account: outsider.account }),
      policy,
      "NotAdmin"
    );
  });

  it("threshold must stay within 1..attesterCount", async () => {
    const { policy } = await deploy(2);
    await viem.assertions.revertWithCustomError(
      policy.write.setThreshold([0], { account: admin.account }),
      policy,
      "InvalidThreshold"
    );
    await viem.assertions.revertWithCustomError(
      policy.write.setThreshold([4], { account: admin.account }),
      policy,
      "InvalidThreshold"
    );
  });

  it("cannot remove attesters below the threshold", async () => {
    const { policy } = await deploy(3);
    await viem.assertions.revertWithCustomError(
      policy.write.removeAttester([attA.account.address], { account: admin.account }),
      policy,
      "InvalidThreshold"
    );
  });
});

describe("immutability", () => {
  it("the only state-changing functions are submit and corroborate", async () => {
    const { registry } = await deploy();
    const mutating = registry.abi
      .filter((f) => f.type === "function" && !["view", "pure"].includes(f.stateMutability as string))
      .map((f) => (f as { name: string }).name)
      .sort();
    assert.deepEqual(mutating, ["corroborate", "submit"]);
    const names = registry.abi.filter((f) => f.type === "function").map((f) => (f as { name: string }).name);
    for (const banned of [/upgrade/i, /owner/i, /admin/i, /pause/i, /delete/i, /remove/i, /set/i, /update/i]) {
      assert.ok(!names.some((n) => banned.test(n)), `unexpected function matching ${banned}`);
    }
  });

  it("deployed bytecode contains no DELEGATECALL, SELFDESTRUCT or CALLCODE opcode", async () => {
    const { registry } = await deploy();
    const code = await publicClient.getCode({ address: registry.address });
    assert.ok(code && code.length > 2);
    const bytes = Buffer.from(code.slice(2), "hex");
    // strip the CBOR metadata trailer: its length is encoded in the final two bytes
    const metaLen = bytes.readUInt16BE(bytes.length - 2) + 2;
    const ops = bytes.subarray(0, bytes.length - metaLen);
    const found: string[] = [];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]!;
      if (op === 0xf4) found.push(`DELEGATECALL@${i}`);
      if (op === 0xff) found.push(`SELFDESTRUCT@${i}`);
      if (op === 0xf2) found.push(`CALLCODE@${i}`);
      if (op >= 0x60 && op <= 0x7f) i += op - 0x5f; // skip PUSH1..PUSH32 immediates
    }
    assert.deepEqual(found, []);
  });
});
