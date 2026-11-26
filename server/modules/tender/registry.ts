import type { NormalizedTender, TenderProvider } from "./provider";
import { samGovProvider, normaliseSamGovOpportunity } from "./adapters/sam-gov";
import { findATenderProvider, normaliseFindATenderRelease } from "./adapters/find-a-tender";
import { canadaBuysProvider, normaliseCanadaBuysRow } from "./adapters/canada-buys";
import { oeffentlichevergabeProvider, normaliseOeffentlichevergabeRelease } from "./adapters/oeffentlichevergabe";
import { tedProvider, normaliseTedNotice } from "./adapters/ted";
import { worldBankProvider, normaliseWorldBankNotice } from "./adapters/world-bank";

/**
 * Tender Bid — adapter registry.
 *
 * Maps a `tender_sources.adapter` value to its provider (how to fetch a page)
 * and its normaliser (how to turn one raw source item into a `NormalizedTender`).
 * Keeping the two together means a new source is one self-contained entry here,
 * and the ingestion worker never needs source-specific knowledge. Adapters that
 * are not yet implemented are simply absent: the worker records the source as
 * `no_adapter` rather than guessing.
 */
export type TenderAdapter = {
  provider: TenderProvider;
  /** Normalise one raw source item, or null when it carries no usable identity. */
  normalise: (raw: unknown) => NormalizedTender | null;
};

export const TENDER_ADAPTERS: Record<string, TenderAdapter> = {
  sam_gov: {
    provider: samGovProvider,
    normalise: (raw) => normaliseSamGovOpportunity(raw as Record<string, unknown>),
  },
  find_a_tender: {
    provider: findATenderProvider,
    normalise: (raw) => normaliseFindATenderRelease(raw as Record<string, unknown>),
  },
  canada_buys: {
    provider: canadaBuysProvider,
    normalise: (raw) => normaliseCanadaBuysRow(raw as Record<string, string>),
  },
  oeffentlichevergabe: {
    provider: oeffentlichevergabeProvider,
    normalise: (raw) => normaliseOeffentlichevergabeRelease(raw as Record<string, unknown>),
  },
  ted: {
    provider: tedProvider,
    normalise: (raw) => normaliseTedNotice(raw as Record<string, unknown>),
  },
  world_bank: {
    provider: worldBankProvider,
    normalise: (raw) => normaliseWorldBankNotice(raw as Record<string, unknown>),
  },
};

/** Resolve the adapter for a registry `adapter` value, or undefined when unimplemented. */
export function resolveTenderAdapter(adapter: string): TenderAdapter | undefined {
  return TENDER_ADAPTERS[adapter.trim()];
}

/** The adapter keys that currently have an implementation (for diagnostics and tests). */
export function listImplementedAdapterKeys(): string[] {
  return Object.keys(TENDER_ADAPTERS);
}
