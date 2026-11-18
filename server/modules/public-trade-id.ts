import crypto from "node:crypto";

const TRADE_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const TRADE_ID_PAYLOAD_LENGTH = 12;
const MAX_ALLOCATION_ATTEMPTS = 8;

export const PUBLIC_TRADE_ID_PATTERN = /^TX-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function generatePublicTradeId(randomIndex: (max: number) => number = crypto.randomInt): string {
  let payload = "";
  for (let index = 0; index < TRADE_ID_PAYLOAD_LENGTH; index += 1) {
    payload += TRADE_ID_ALPHABET[randomIndex(TRADE_ID_ALPHABET.length)];
  }
  return `TX-${payload.slice(0, 4)}-${payload.slice(4, 8)}-${payload.slice(8, 12)}`;
}

export async function reserveUniquePublicTradeId(
  insertIfUnique: (publicTradeId: string) => Promise<boolean>,
  generate: () => string = generatePublicTradeId,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
    const publicTradeId = generate();
    if (!PUBLIC_TRADE_ID_PATTERN.test(publicTradeId)) {
      throw new Error("Generated public trade ID does not match the required format.");
    }
    if (await insertIfUnique(publicTradeId)) return publicTradeId;
  }
  throw new Error("Could not reserve a unique public trade ID after repeated collisions.");
}
