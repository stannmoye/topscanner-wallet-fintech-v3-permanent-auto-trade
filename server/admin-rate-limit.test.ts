import { describe, expect, it } from "vitest";
import { adminProcedure, router } from "./_core/trpc";
import type { TrpcContext } from "./_core/context";
import {
  ADMIN_MUTATION_RATE_LIMIT_MAX,
  ADMIN_MUTATION_RATE_LIMIT_WINDOW_MS,
  createAdminMutationRateLimiter,
} from "./_core/adminRateLimit";

function adminContext(id: number): TrpcContext {
  const now = new Date();
  return {
    user: {
      id,
      openId: `admin-rate-limit-${id}`,
      email: `admin-rate-limit-${id}@example.com`,
      name: "Admin Rate Limit",
      loginMethod: "password",
      role: "admin",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("item 49: administrator mutation rate limiter", () => {
  it("is generous enough that it can never constrain ordinary administrator use", () => {
    expect(ADMIN_MUTATION_RATE_LIMIT_MAX).toBeGreaterThanOrEqual(300);
    expect(ADMIN_MUTATION_RATE_LIMIT_WINDOW_MS).toBe(5 * 60_000);
  });

  it("allows actions up to the limit and isolates one administrator from another", async () => {
    let now = 0;
    const consume = createAdminMutationRateLimiter({ windowMs: 1000, max: 3, now: () => now });

    await consume(1);
    await consume(1);
    await consume(1);
    await expect(consume(1)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });

    // A second administrator keeps a full, independent budget.
    await consume(2);
    await consume(2);
    await consume(2);
    await expect(consume(2)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("lets the budget recover once the window elapses", async () => {
    let now = 0;
    const consume = createAdminMutationRateLimiter({ windowMs: 1000, max: 2, now: () => now });
    await consume(5);
    await consume(5);
    await expect(consume(5)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    now = 1001;
    await expect(consume(5)).resolves.toBeUndefined();
  });

  it("fails open when a configured shared store errors, so an administrator is never locked out", async () => {
    const consume = createAdminMutationRateLimiter({
      windowMs: 1000,
      max: 1,
      store: { consume: async () => { throw new Error("store unavailable"); } },
    });
    await expect(consume(1)).resolves.toBeUndefined();
    await expect(consume(1)).resolves.toBeUndefined();
  });

  it("enforces the shared store when it is healthy", async () => {
    let count = 0;
    const consume = createAdminMutationRateLimiter({
      windowMs: 1000,
      max: 1,
      store: { consume: async () => ({ count: ++count, resetMs: 1000 }) },
    });
    await expect(consume(9)).resolves.toBeUndefined();
    await expect(consume(9)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("limits administrator mutations on the tRPC surface but never administrator reads", async () => {
    const probe = router({
      adminMutation: adminProcedure.mutation(() => "ok"),
      adminRead: adminProcedure.query(() => "ok"),
    });
    // A unique account id keeps this probe independent of any other test in the file.
    const caller = probe.createCaller(adminContext(999_001));

    for (let attempt = 0; attempt < ADMIN_MUTATION_RATE_LIMIT_MAX; attempt += 1) {
      await expect(caller.adminMutation()).resolves.toBe("ok");
    }
    await expect(caller.adminMutation()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });

    // Reads are exempt, so continuous console polling is unaffected.
    await expect(caller.adminRead()).resolves.toBe("ok");
    await expect(caller.adminRead()).resolves.toBe("ok");
  });

  it("never lets a non-administrator consume an administrator's budget", async () => {
    const probe = router({ adminMutation: adminProcedure.mutation(() => "ok") });
    const base = adminContext(999_002);
    const customerCaller = probe.createCaller({ ...base, user: base.user ? { ...base.user, role: "user" } : null });
    for (let attempt = 0; attempt < ADMIN_MUTATION_RATE_LIMIT_MAX + 5; attempt += 1) {
      await expect(customerCaller.adminMutation()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    // The administrator still has a full budget afterwards.
    const adminCaller = probe.createCaller(base);
    await expect(adminCaller.adminMutation()).resolves.toBe("ok");
  });
});
