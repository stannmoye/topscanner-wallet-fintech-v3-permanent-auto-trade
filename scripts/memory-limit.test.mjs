import { describe, expect, it } from "vitest";
import {
  computeMemoryFlags,
  detectMemoryLimitBytes,
  mergeNodeOptions,
  resolveMemoryFlags,
} from "./memory-limit.mjs";

const MIB = 1024 * 1024;

describe("container-aware V8 memory sizing", () => {
  it("sizes the heap inside the limit and caps growth on very large hosts", () => {
    // Server MB -> { maxOldSpaceSizeMb, maxSemiSpaceSizeMb }
    // The heap plus the ~320 MB reserve (resident wrapper + off-heap floor) must
    // stay under the server's limit, so a 512 MB server gets a 192 MB heap and
    // its whole process tree peaks well below 512 MB.
    const expected = new Map([
      [128, { maxOldSpaceSizeMb: 96, maxSemiSpaceSizeMb: 3 }],
      [256, { maxOldSpaceSizeMb: 96, maxSemiSpaceSizeMb: 3 }],
      [384, { maxOldSpaceSizeMb: 96, maxSemiSpaceSizeMb: 3 }],
      [512, { maxOldSpaceSizeMb: 192, maxSemiSpaceSizeMb: 6 }],
      [1024, { maxOldSpaceSizeMb: 512, maxSemiSpaceSizeMb: 16 }],
      [2048, { maxOldSpaceSizeMb: 1024, maxSemiSpaceSizeMb: 16 }],
      [4096, { maxOldSpaceSizeMb: 2048, maxSemiSpaceSizeMb: 16 }],
      [8192, { maxOldSpaceSizeMb: 4096, maxSemiSpaceSizeMb: 16 }],
      [16384, { maxOldSpaceSizeMb: 4096, maxSemiSpaceSizeMb: 16 }],
      [65536, { maxOldSpaceSizeMb: 4096, maxSemiSpaceSizeMb: 16 }],
    ]);
    for (const [limitMib, flags] of expected) {
      expect(computeMemoryFlags(limitMib * MIB)).toEqual({ limitMib, ...flags });
    }
  });

  it("never drops below the smallest old space that still boots the app", () => {
    expect(computeMemoryFlags(64 * MIB).maxOldSpaceSizeMb).toBe(96);
    expect(computeMemoryFlags(1 * MIB).maxOldSpaceSizeMb).toBe(96);
  });

  it("prefers an explicit override when one is configured", () => {
    const flags = resolveMemoryFlags({ APP_MAX_OLD_SPACE_MB: "640", APP_MAX_SEMI_SPACE_MB: "7" });
    expect(flags.maxOldSpaceSizeMb).toBe(640);
    expect(flags.maxSemiSpaceSizeMb).toBe(7);
  });

  it("ignores invalid overrides and keeps the detected values", () => {
    const detected = computeMemoryFlags(detectMemoryLimitBytes());
    const flags = resolveMemoryFlags({ APP_MAX_OLD_SPACE_MB: "0", APP_MAX_SEMI_SPACE_MB: "abc" });
    expect(flags.maxOldSpaceSizeMb).toBe(detected.maxOldSpaceSizeMb);
    expect(flags.maxSemiSpaceSizeMb).toBe(detected.maxSemiSpaceSizeMb);
  });

  it("honours an explicitly declared server size when detection is wrong or impossible", () => {
    const flags = resolveMemoryFlags({ APP_MEMORY_LIMIT_MB: "512" });
    expect(flags.limitMib).toBe(512);
    expect(flags.maxOldSpaceSizeMb).toBe(192);
    expect(flags.maxSemiSpaceSizeMb).toBe(6);
  });

  it("ignores invalid declared sizes and keeps the detected values", () => {
    const detected = computeMemoryFlags(detectMemoryLimitBytes());
    const flags = resolveMemoryFlags({ APP_MEMORY_LIMIT_MB: "0" });
    expect(flags.maxOldSpaceSizeMb).toBe(detected.maxOldSpaceSizeMb);
  });

  it("reports a positive detected limit", () => {
    expect(detectMemoryLimitBytes()).toBeGreaterThan(0);
  });
});

describe("mergeNodeOptions", () => {
  it("replaces stale heap bounds while preserving unrelated options", () => {
    const merged = mergeNodeOptions("--enable-source-maps --max-old-space-size=999", {
      maxOldSpaceSizeMb: 256,
      maxSemiSpaceSizeMb: 8,
    });
    expect(merged).toBe("--enable-source-maps --max-old-space-size=256 --max-semi-space-size=8");
  });

  it("removes any previous semi-space bound too", () => {
    const merged = mergeNodeOptions("--max-semi-space-size=64", {
      maxOldSpaceSizeMb: 96,
      maxSemiSpaceSizeMb: 3,
    });
    expect(merged).toBe("--max-old-space-size=96 --max-semi-space-size=3");
  });

  it("handles an empty environment value", () => {
    const merged = mergeNodeOptions(undefined, { maxOldSpaceSizeMb: 512, maxSemiSpaceSizeMb: 16 });
    expect(merged).toBe("--max-old-space-size=512 --max-semi-space-size=16");
  });
});
