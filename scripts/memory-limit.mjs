// Container-aware V8 memory sizing.
//
// In a container `os.totalmem()` reports the *host's* physical RAM, not the
// container's cgroup limit. Node derives its default old-space ceiling from that
// figure, so a small container on a large host is allowed to grow the heap past
// the container limit until the kernel OOM-kills it ("JavaScript heap out of
// memory", or an abrupt SIGKILL / exit 137). Node's default young generation
// (semi-space) is likewise oversized and alone accounts for ~100 MB of RSS.
//
// To work on any server — a small container up to a 64 GB host — we read the
// real cgroup limit and pin `--max-old-space-size` and `--max-semi-space-size`
// inside it, reserving headroom for the memory that does not shrink with the
// heap and capping growth on very large hosts so the heap can never balloon.
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";

const MIB = 1024 * 1024;

// The heap may use at most half the detected limit, and never more than the
// limit minus this reserve. The reserve covers memory that does NOT shrink with
// the heap, measured for this app's whole process tree:
//   - the resident wrapper supervisor (scripts/start-with-diagnostics.mjs) stays
//     alive for the server's entire lifetime                  ~80 MB
//   - the Node/V8 binary, code cache and libuv                ~50 MB
//   - native buffers, worker stacks and the mysql2 pools     ~135 MB
//   - a safety margin so the tree stays under the limit even
//     when the heap fills completely                          ~55 MB
// Total ~320 MB. Without this the tree could reach
// (off-heap + full heap) and the kernel would OOM-kill the container.
const HEAP_FRACTION = 0.5;
const RESERVE_MIB = 320;

// Bounds. MIN_OLD is the smallest old-space that still boots this app (64 MB
// aborts during startup); MAX_OLD keeps the heap sane on very large hosts.
const MIN_OLD_MIB = 96;
const MAX_OLD_MIB = 4096;
const MIN_SEMI_MIB = 2;
const MAX_SEMI_MIB = 16;

// When we are demonstrably inside a container but cannot read its cgroup memory
// limit, we must NOT fall back to the host's RAM — that is exactly the bug that
// lets V8 grow past the container limit until the kernel OOM-kills it. Assume a
// small, safe container instead. An operator running a larger container (or a
// host whose cgroup files are not exposed) can declare the real size with
// APP_MEMORY_LIMIT_MB.
const DEFAULT_CONTAINER_MIB = 512;

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

function inContainer() {
  if (existsSync("/.dockerenv") || existsSync("/run/.containerenv")) return true;
  if (process.env.KUBERNETES_SERVICE_HOST) return true;
  try {
    const self = readFileSync("/proc/self/cgroup", "utf8");
    return /(?:docker|kubepods|containerd|lxc|podman|garden)/.test(self);
  } catch {
    return false;
  }
}

export function detectMemoryLimitBytes() {
  const cgroup =
    readCgroupLimit("/sys/fs/cgroup/memory.max") ??
    readCgroupLimit("/sys/fs/cgroup/memory.high") ??
    readCgroupLimit("/sys/fs/cgroup/memory/memory.limit_in_bytes");
  if (cgroup) return cgroup;
  // No readable cgroup ceiling. In a container the host's total RAM is not our
  // budget, so assume a conservative container size. Only a genuine bare-metal
  // host (or VM) is safe to size from its own total RAM.
  if (inContainer()) return DEFAULT_CONTAINER_MIB * MIB;
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
  // An operator can declare the server's real memory when detection is wrong or
  // impossible (a host whose cgroup files are not exposed, a large container
  // that reports no limit, or a shared box that also runs the database).
  const declaredMib = Number(env.APP_MEMORY_LIMIT_MB);
  const detected =
    Number.isFinite(declaredMib) && declaredMib > 0
      ? computeMemoryFlags(Math.floor(declaredMib) * MIB)
      : computeMemoryFlags(detectMemoryLimitBytes());
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
