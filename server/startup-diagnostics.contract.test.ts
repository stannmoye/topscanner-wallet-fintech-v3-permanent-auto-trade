import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("production startup diagnostics contract", () => {
  it("routes package and container startup through the same diagnostic launcher", () => {
    const packageJson = JSON.parse(read("package.json")) as { scripts?: { start?: string } };
    const dockerfile = read("Dockerfile");
    const railway = JSON.parse(read("railway.json")) as { deploy?: { startCommand?: string } };
    const buildSource = JSON.parse(read("BUILD_SOURCE.json")) as { runtime?: { start_command?: string } };
    expect(packageJson.scripts?.start).toBe("node scripts/start-with-diagnostics.mjs");
    expect(dockerfile).toContain('CMD ["node", "scripts/start-with-diagnostics.mjs"]');
    expect(railway.deploy?.startCommand).toBe("node scripts/start-with-diagnostics.mjs");
    expect(buildSource.runtime?.start_command).toBe("node scripts/start-with-diagnostics.mjs");
  });

  it("records each startup phase and failures with stack, code, and secret redaction", () => {
    const launcher = read("scripts/start-with-diagnostics.mjs");
    expect(launcher).toContain('"startup-begin"');
    expect(launcher).toContain('"phase-start"');
    expect(launcher).toContain('"phase-failed"');
    expect(launcher).toContain('"startup-aborted"');
    expect(launcher).toContain('runPhase("mining-current-schema-repair", ["scripts/ensure-mining-current-schema.mjs"])');
    expect(launcher).toContain("stack:");
    expect(launcher).toContain('[database-url-redacted]');
    expect(launcher).toContain('"--unhandled-rejections=strict"');
  });

  it("records the application bootstrap, HTTP listener readiness, and detailed bootstrap errors", () => {
    const server = read("server/_core/index.ts");
    expect(server).toContain('"application-bootstrap-entered"');
    expect(server).toContain('"routes-and-static-setup-complete"');
    expect(server).toContain('"http-listener-starting"');
    expect(server).toContain('"http-listener-ready"');
    expect(server).toContain('"application-bootstrap-failed"');
    expect(server).toContain("stack:");
  });

  it("bounds the V8 heap adaptively on every deployment path", () => {
    const dockerfile = read("Dockerfile");
    const launcher = read("scripts/start-with-diagnostics.mjs");
    const vpsSetup = read("installer/vps-setup.sh");
    // The launcher derives the heap bound from the real cgroup/host limit and
    // hands it to every spawned phase, so the process cannot be OOM-killed on
    // any server size (256 MB container up to a 64 GB host).
    expect(launcher).toContain('from "./memory-limit.mjs"');
    expect(launcher).toContain("resolveMemoryFlags");
    expect(launcher).toContain("NODE_OPTIONS:");
    // No static heap bound may be baked into the image; the runtime decides.
    expect(dockerfile).not.toContain("max-old-space-size");
    // The VPS systemd unit launches through the same adaptive launcher instead of
    // running dist/index.js directly.
    expect(vpsSetup).toContain("scripts/run-server.sh");
  });
});
