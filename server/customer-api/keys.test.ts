import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiSecret, parseApiKey } from "./keys";

describe("customer API key material", () => {
  it("generates a key whose public prefix and secret round-trip through the parser", () => {
    const issued = generateApiKey("live");
    expect(issued.key.startsWith("ak_live_")).toBe(true);
    expect(issued.key.startsWith(issued.prefix)).toBe(true);
    const parsed = parseApiKey(issued.key);
    expect(parsed).not.toBeNull();
    expect(parsed?.environment).toBe("live");
    expect(parsed?.prefix).toBe(issued.prefix);
    expect(parsed?.secret).toHaveLength(64);
  });

  it("generates distinct secrets and an environment-scoped prefix", () => {
    const a = generateApiKey("live");
    const b = generateApiKey("test");
    expect(a.key).not.toBe(b.key);
    expect(b.prefix.startsWith("ak_test_")).toBe(true);
  });

  it("rejects malformed or non-key inputs", () => {
    expect(parseApiKey("")).toBeNull();
    expect(parseApiKey("ak_live_short_deadbeef")).toBeNull();
    expect(parseApiKey("sk_live_0123456789abcdef_" + "a".repeat(64))).toBeNull();
    expect(parseApiKey("ak_live_0123456789abcdef_" + "z".repeat(64))).toBeNull();
  });

  it("hashes deterministically to a 64-char hex digest and never echoes the secret", () => {
    const digest = hashApiSecret("hunter2");
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(hashApiSecret("hunter2")).toBe(digest);
    expect(hashApiSecret("hunter3")).not.toBe(digest);
  });
});
