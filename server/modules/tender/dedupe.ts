import { createHash } from "node:crypto";

/**
 * Tender Bid — cross-source deduplication key.
 *
 * A tender seen through two sources (for example a UK notice that also appears on
 * EU TED) is kept as two source records — each carries a real source URL and its
 * own `(sourceId, externalId)` identity — but they share a `dedupeGroup` so the
 * customer desk can show the tender once with every source link. The group is a
 * stable hash of a low-noise signature: the buyer and the title, case-folded and
 * stripped of punctuation. It deliberately excludes the amount and dates, which
 * change between the original notice and a later revision, and excludes the
 * source, which is exactly what we want to collapse.
 */
export function computeTenderDedupeGroup(input: {
  countryCode?: string | null;
  buyer?: string | null;
  title: string;
}): string {
  const signature = normaliseSignaturePart(input.buyer) + "|" + normaliseSignaturePart(input.title);
  return createHash("sha256").update(signature).digest("hex").slice(0, 64);
}

function normaliseSignaturePart(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
