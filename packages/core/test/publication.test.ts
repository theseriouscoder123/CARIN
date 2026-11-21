import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  ConfigError,
  LocalPayloadStore,
  ManifestError,
  NpmAdapter,
  RegistryError,
  computeArtifactDigest,
  canonicaliseTarball,
  encodePackageName,
  preparePublication,
  readPackageManifest,
  resolveRegistryAddress,
  type FetchLike
} from "../src/index.js";
import { writeTar } from "./helpers/tar.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const TGZ = readFileSync(join(FIXTURES, "cairn-demo-greeting-1.0.0.tgz"));
const PUBLISHER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "cairn-pub-"));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Hand-written fake registry: a map of URL → response. */
function fakeFetch(routes: Record<string, { status?: number; json?: unknown; body?: Uint8Array }>): FetchLike {
  return async (url) => {
    const r = routes[url];
    if (!r) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    const status = r.status ?? 200;
    return {
      ok: status < 400,
      status,
      json: async () => r.json,
      arrayBuffer: async () => {
        const b = r.body ?? new Uint8Array();
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      }
    };
  };
}

describe("NpmAdapter", () => {
  const REG = "http://registry.test";
  const tarball = `${REG}/@cairn-demo/greeting/-/greeting-1.0.0.tgz`;
  const adapter = new NpmAdapter({
    registryUrl: `${REG}/`,
    fetch: fakeFetch({
      [`${REG}/@cairn-demo%2Fgreeting/1.0.0`]: {
        json: { name: "@cairn-demo/greeting", version: "1.0.0", dist: { tarball, integrity: "sha512-x" } }
      },
      [`${REG}/liar/1.0.0`]: { json: { name: "other", version: "1.0.0", dist: { tarball } } },
      [tarball]: { body: TGZ }
    })
  });

  it("encodes scoped names as one path segment", () => {
    expect(encodePackageName("@scope/pkg")).toBe("@scope%2Fpkg");
    expect(encodePackageName("left-pad")).toBe("left-pad");
  });

  it("resolves and fetches a scoped package", async () => {
    const ref = await adapter.resolve("@cairn-demo/greeting", "1.0.0");
    expect(ref.tarballUrl).toBe(tarball);
    const bytes = await adapter.fetch(ref);
    expect(Buffer.from(bytes).equals(TGZ)).toBe(true);
  });

  it("404 surfaces as RegistryError with notFound", async () => {
    await expect(adapter.resolve("missing", "1.0.0")).rejects.toMatchObject({ notFound: true });
  });

  it("rejects a registry answer for a different package", async () => {
    await expect(adapter.resolve("liar", "1.0.0")).rejects.toThrow(RegistryError);
  });
});

describe("readPackageManifest", () => {
  it("reads name and version from the npm fixture", () => {
    expect(readPackageManifest(TGZ)).toEqual({ name: "@cairn-demo/greeting", version: "1.0.0" });
  });

  it("ignores nested package.json files", () => {
    const t = writeTar([
      { path: "package/node_modules/dep/package.json", data: '{"name":"dep","version":"9.9.9"}' },
      { path: "package/package.json", data: '{"name":"top","version":"1.2.3"}' }
    ]);
    expect(readPackageManifest(t)).toEqual({ name: "top", version: "1.2.3" });
  });

  it("throws ManifestError without a root package.json", () => {
    expect(() => readPackageManifest(writeTar([{ path: "package/index.js", data: "1" }]))).toThrow(ManifestError);
  });
});

describe("preparePublication", () => {
  it("produces the same artifactDigest as the core digest path", () => {
    const pub = preparePublication({
      bytes: TGZ,
      ecosystem: "npm",
      name: "@cairn-demo/greeting",
      version: "1.0.0",
      publisher: PUBLISHER,
      producedAt: new Date("2026-11-21T00:00:00Z")
    });
    expect(pub.artifactDigest).toBe(computeArtifactDigest(canonicaliseTarball(TGZ)));
    expect(pub.payload.entryCount).toBe(4);
    expect(pub.payload.publisher).toBe(PUBLISHER);
  });
});

describe("LocalPayloadStore", () => {
  it("round-trips and keys by payloadDigest", async () => {
    const store = new LocalPayloadStore(tmp());
    const pub = preparePublication({ bytes: TGZ, ecosystem: "npm", name: "x", version: "1.0.0", publisher: PUBLISHER });
    const { digest } = await store.put(pub.payload);
    expect(digest).toBe(pub.payloadDigest);
    expect(await store.get(digest)).toEqual(JSON.parse(JSON.stringify(pub.payload)));
  });

  it("rejects a payload file whose bytes no longer match its key", async () => {
    const dir = tmp();
    const store = new LocalPayloadStore(dir);
    const pub = preparePublication({ bytes: TGZ, ecosystem: "npm", name: "x", version: "1.0.0", publisher: PUBLISHER });
    const { digest, location } = await store.put(pub.payload);
    writeFileSync(location, readFileSync(location, "utf8").replace('"x"', '"y"'));
    await expect(store.get(digest)).rejects.toThrow(/hashes to/);
  });
});

describe("resolveRegistryAddress", () => {
  const deployment = {
    chainId: 31337,
    registry: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    quorumPolicy: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    deployedAtBlock: 1,
    deployer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    attesters: [],
    threshold: 2,
    abiHash: "0x",
    deployedAt: "2026-11-21T00:00:00Z"
  };

  it("explicit address wins", () => {
    const r = resolveRegistryAddress({ chainId: 1, explicit: deployment.registry.toLowerCase(), env: {} });
    expect(r.address).toBe(deployment.registry);
  });

  it("reads the deployment file and checks its chain id", () => {
    const file = join(tmp(), "31337.json");
    writeFileSync(file, JSON.stringify(deployment));
    expect(resolveRegistryAddress({ chainId: 31337, deploymentFile: file, env: {} }).address).toBe(deployment.registry);
    expect(() => resolveRegistryAddress({ chainId: 84532, deploymentFile: file, env: {} })).toThrow(ConfigError);
  });
});
