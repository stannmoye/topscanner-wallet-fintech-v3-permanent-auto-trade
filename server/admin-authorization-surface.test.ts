import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function contextFor(role: "user" | "admin" | null): TrpcContext {
  const now = new Date();
  return {
    user:
      role === null
        ? null
        : {
            id: role === "admin" ? 1 : 7,
            openId: "admin-authorization-surface",
            email: "admin-authorization-surface@example.com",
            name: "Authorization Surface",
            loginMethod: "password",
            role,
            createdAt: now,
            updatedAt: now,
            lastSignedIn: now,
          },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

// Item 49: lock in the server-side role check for the entire administrator surface.
// The paths are derived from the router definition itself, so a newly added panel
// procedure is covered automatically without editing this test.
const ADMIN_ROUTER_PREFIXES = ["adminOperations.", "companyCatalogueReference."];
const adminProcedurePaths = Object.keys(appRouter._def.procedures)
  .filter(path => ADMIN_ROUTER_PREFIXES.some(prefix => path.startsWith(prefix)))
  .sort();

function resolveProcedure(caller: unknown, path: string): () => Promise<unknown> {
  let node: unknown = caller;
  for (const segment of path.split(".")) {
    node = (node as Record<string, unknown>)[segment];
  }
  if (typeof node !== "function") throw new Error(`Router path ${path} is not callable`);
  return node as () => Promise<unknown>;
}

async function assertAllRejectForbidden(role: "user" | null): Promise<string[]> {
  const caller = appRouter.createCaller(contextFor(role));
  const unprotected: string[] = [];
  for (const path of adminProcedurePaths) {
    try {
      const result = await resolveProcedure(caller, path)();
      // Any resolution means the procedure executed for a non-administrator.
      unprotected.push(`${path} -> resolved (${JSON.stringify(result)?.slice(0, 40)})`);
    } catch (error) {
      const code = error instanceof TRPCError ? error.code : "UNKNOWN";
      // The administrator gate runs before input validation, so a denied caller
      // must always receive FORBIDDEN (never a validation error).
      if (code !== "FORBIDDEN") unprotected.push(`${path} -> ${code}`);
    }
  }
  return unprotected;
}

describe("item 49: administrator authorization surface", () => {
  it("discovers a substantial administrator surface to verify", () => {
    expect(adminProcedurePaths.length).toBeGreaterThan(50);
  });

  it("rejects every administrator procedure for a customer session", async () => {
    await expect(assertAllRejectForbidden("user")).resolves.toEqual([]);
  });

  it("rejects every administrator procedure for an anonymous caller", async () => {
    await expect(assertAllRejectForbidden(null)).resolves.toEqual([]);
  });
});
