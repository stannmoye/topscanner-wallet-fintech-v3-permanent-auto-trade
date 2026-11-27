// Container-aware V8 memory sizing.
//
// In a container `os.totalmem()` reports the *host's* physical RAM, not the
// container's cgroup limit. Node derives its default old-space ceiling from that
// figure, so a small container on a large host is allowed to grow the heap past
// the container limit until the kernel OOM-kills it ("JavaScript heap out of
// memory", or an abrupt SIGKILL / exit 137). Node's default young generation
// (semi-space) is likewise oversized and alone accounts for ~100 MB of RSS.
//
// To work on any server — a 256 MB container up to a 64 GB host — we read the
// real cgroup limit and pin `--max-old-space-size` and `--max-semi-space-size`
// inside it, reserving headroom for off-heap memory and capping growth on very
// large hosts so the heap can never balloon.
import { readFileSync } from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";

const MIB = 1024 * 1024;

// The heap may use at most half the detected limit, and never more than the
// limit minus this reserve. The reserve covers off-heap memory that does not
// shrink with the heap: the Node/V8 binary and code cache, native buffers, libuv
// and V8 worker-thread stacks, and the mysql2 connection pools. Measured on this
// app the off-heap floor is roughly 185 MB, so the reserve is set a little below
// that with headroom.
const HEAP_FRACTION = 0.5;
const RESERVE_MIB = 160;

// Bounds. MIN_OLD is the smallest old-space that still boots this app (64 MB
// aborts during startup); MAX_OLD keeps the heap sane on very large hosts.
const MIN_OLD_MIB = 96;
const MAX_OLD_MIB = 4096;
const MIN_SEMI_MIB = 2;
const MAX_SEMI_MIB = 16;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function readCgroupLimit(path) {
  try {
    const raw = readFileSync(path, "utf8").trim();
    if (!raw || raw === "max") return null;
    const value = Number(raw);
    // cgroup v1 reports ~2^63-1 as "unlimited"; treat anything astronomically
    // large as no limit rather than as a real ceiling.
    if (!Number.isFinite(value) || value <= 0 || value >= 2 ** 62) return null;
    return value;
  } catch {
    return null;
  }
}

export function detectMemoryLimitBytes() {
  const cgroup =
    readCgroupLimit("/sys/fs/cgroup/memory.max") ??
    readCgroupLimit("/sys/fs/cgroup/memory/memory.limit_in_bytes");
  if (cgroup) return cgroup;
  return os.totalmem();
}

export function computeMemoryFlags(limitBytes) {
  const limitMib = Math.floor(limitBytes / MIB);
  const maxOldSpaceSizeMb = clamp(
    Math.floor(Math.min(limitMib * HEAP_FRACTION, limitMib - RESERVE_MIB)),
    MIN_OLD_MIB,
    MAX_OLD_MIB,
  );
  const maxSemiSpaceSizeMb = clamp(
    Math.round(maxOldSpaceSizeMb / 32),
    MIN_SEMI_MIB,
    MAX_SEMI_MIB,
  );
  return { limitMib, maxOldSpaceSizeMb, maxSemiSpaceSizeMb };
}

export function resolveMemoryFlags(env = process.env) {
  const detected = computeMemoryFlags(detectMemoryLimitBytes());
  const oldOverride = Number(env.APP_MAX_OLD_SPACE_MB);
  const semiOverride = Number(env.APP_MAX_SEMI_SPACE_MB);
  return {
    limitMib: detected.limitMib,
    maxOldSpaceSizeMb:
      Number.isFinite(oldOverride) && oldOverride > 0
        ? Math.floor(oldOverride)
        : detected.maxOldSpaceSizeMb,
    maxSemiSpaceSizeMb:
      Number.isFinite(semiOverride) && semiOverride > 0
        ? Math.floor(semiOverride)
        : detected.maxSemiSpaceSizeMb,
  };
}

/**
 * Build the NODE_OPTIONS string for a child process. Any pre-existing
 * `--max-old-space-size` / `--max-semi-space-size` (for example a static value
 * baked into the image) is replaced so the adaptive values always win, while
 * unrelated options are preserved.
 */
export function mergeNodeOptions(current, { maxOldSpaceSizeMb, maxSemiSpaceSizeMb }) {
  const stripped = String(current ?? "")
    .replace(/--max-old-space-size=\S+/g, "")
    .replace(/--max-semi-space-size=\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return [
    stripped,
    `--max-old-space-size=${maxOldSpaceSizeMb}`,
    `--max-semi-space-size=${maxSemiSpaceSizeMb}`,
  ]
    .filter(Boolean)
    .join(" ");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = resolveMemoryFlags();
  if (process.argv.includes("--node-options")) {
    // Machine-readable mode for shell launchers: print exactly the NODE_OPTIONS
    // value to export. Existing options are merged in so unrelated flags survive
    // while any stale heap/semi-space bounds are replaced.
    process.stdout.write(`${mergeNodeOptions(process.env.NODE_OPTIONS, flags)}\n`);
  } else {
    console.log(
      `detectedLimitMB=${flags.limitMib} maxOldSpaceSizeMB=${flags.maxOldSpaceSizeMb} maxSemiSpaceSizeMB=${flags.maxSemiSpaceSizeMb}`,
    );
  }
}
