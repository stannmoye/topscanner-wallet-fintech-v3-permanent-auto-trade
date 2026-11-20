import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { getUserById } from "../db";
import { isDeviceBlocked } from "../trusted-devices";
import { getLocalSessionFromRequest } from "./localAuth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    const local = getLocalSessionFromRequest(opts.req);
    if (local) {
      const candidate = await getUserById(local.userId);
      if (candidate && Number(candidate.authVersion || 0) === local.authVersion) {
        // A device-bound session is rejected the moment its device is blocked,
        // which is how "revoke this device" expires the device's live sessions
        // without signing the customer out everywhere else.
        const blocked = local.deviceKey ? await isDeviceBlocked(local.userId, local.deviceKey) : false;
        if (!blocked) user = candidate;
      }
    }
  } catch {
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
