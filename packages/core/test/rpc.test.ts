import { describe, expect, it } from "vitest";
import { parseRpcUrls, primaryRpc } from "../src/index.js";

describe("RPC failover configuration", () => {
  it("accepts one URL or a comma-separated list", () => {
    expect(parseRpcUrls("https://a.test")).toEqual(["https://a.test"]);
    expect(parseRpcUrls(" https://a.test , https://b.test ,")).toEqual(["https://a.test", "https://b.test"]);
  });

  it("rejects an empty configuration", () => {
    expect(() => parseRpcUrls(" , ")).toThrow(RangeError);
  });

  it("displays only the primary endpoint without query strings", () => {
    expect(primaryRpc("https://a.test/rpc?key=secret,https://b.test")).toBe("https://a.test/rpc");
  });
});
