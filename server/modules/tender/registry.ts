import type { NormalizedTender, TenderProvider } from "./provider";
import { samGovProvider, normaliseSamGovOpportunity } from "./adapters/sam-gov";
import { findATenderProvider, normaliseFindATenderRelease } from "./adapters/find-a-tender";
import { canadaBuysProvider, normaliseCanadaBuysRow } from "./adapters/canada-buys";
import { oeffentlichevergabeProvider, normaliseOeffentlichevergabeRelease } from "./adapters/oeffentlichevergabe";
import { boampProvider, normaliseBoampRecord } from "./adapters/boamp";
import { tendernedProvider, normaliseTenderNedPublication } from "./adapters/tenderned";
import { enotificationProvider, normaliseEnotificationRow } from "./adapters/enotification";
import { placspProvider, normalisePlacspEntry } from "./adapters/placsp";
import { anacProvider, normaliseAnacRelease } from "./adapters/anac";
import { ezamowieniaProvider, normaliseEzamowieniaNotice } from "./adapters/ezamowienia";
import { udbudProvider, normaliseUdbudNotice } from "./adapters/udbud";
import { hilmaProvider, normaliseHilmaRow } from "./adapters/hilma";
import { etendersProvider, normaliseEtendersRow } from "./adapters/etenders";
import { doffinProvider, normaliseDoffinRow } from "./adapters/doffin";
import { simapProvider, normaliseSimapProject } from "./adapters/simap";
import { austenderProvider, normaliseAustenderRelease } from "./adapters/austender";
import { cpppProvider, normaliseCpppRow } from "./adapters/cppp";
import { nocopoProvider, normaliseNocopoRow } from "./adapters/nocopo";
import { ppipProvider, normalisePpipTender } from "./adapters/ppip";
import { zaEtendersProvider, normaliseZaEtendersRelease } from "./adapters/za-etenders";
import { ghanepsProvider, normaliseGhanepsRow } from "./adapters/ghaneps";
import { etimadProvider, normaliseEtimadTender } from "./adapters/etimad";
import { tedProvider, normaliseTedNotice } from "./adapters/ted";
import { worldBankProvider, normaliseWorldBankNotice } from "./adapters/world-bank";
import { ungmProvider, normaliseUngmRow } from "./adapters/ungm";
import { afdbProvider, normaliseAfdbRow } from "./adapters/afdb";
import { adbProvider, normaliseAdbRow } from "./adapters/adb";

/**
 * Tender Bid — adapter registry.
 *
 * Maps a `tender_sources.adapter` value to its provider (how to fetch a page)
 * and its normaliser (how to turn one raw source item into a `NormalizedTender`).
 * Keeping the two together means a new source is one self-contained entry here,
 * and the ingestion worker never needs source-specific knowledge. Adapters that
 * are not yet implemented are simply absent: the worker records the source as
 * `no_adapter` rather than guessing.
 *
 * Stage 6 completes the catalogue: every one of the 23 country sources and the 5
 * supranational sources now resolves to an adapter. Sources that publish a
 * documented API/OCDS feed are read directly; sources that are HTML-only or
 * bot-protected use the tolerant HTML-listing scraper and fail closed (the source
 * is flagged unhealthy rather than a tender being fabricated).
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
  boamp: {
    provider: boampProvider,
    normalise: (raw) => normaliseBoampRecord(raw as Record<string, unknown>),
  },
  tenderned: {
    provider: tendernedProvider,
    normalise: (raw) => normaliseTenderNedPublication(raw as Record<string, unknown>),
  },
  enotification: {
    provider: enotificationProvider,
    normalise: (raw) => normaliseEnotificationRow(raw as Record<string, unknown>),
  },
  placsp: {
    provider: placspProvider,
    normalise: (raw) => normalisePlacspEntry(raw as Record<string, unknown>),
  },
  anac: {
    provider: anacProvider,
    normalise: (raw) => normaliseAnacRelease(raw as Record<string, unknown>),
  },
  ezamowienia: {
    provider: ezamowieniaProvider,
    normalise: (raw) => normaliseEzamowieniaNotice(raw as Record<string, unknown>),
  },
  udbud: {
    provider: udbudProvider,
    normalise: (raw) => normaliseUdbudNotice(raw as Record<string, unknown>),
  },
  hilma: {
    provider: hilmaProvider,
    normalise: (raw) => normaliseHilmaRow(raw as Record<string, unknown>),
  },
  etenders: {
    provider: etendersProvider,
    normalise: (raw) => normaliseEtendersRow(raw as Record<string, unknown>),
  },
  doffin: {
    provider: doffinProvider,
    normalise: (raw) => normaliseDoffinRow(raw as Record<string, unknown>),
  },
  simap: {
    provider: simapProvider,
    normalise: (raw) => normaliseSimapProject(raw as Record<string, unknown>),
  },
  austender: {
    provider: austenderProvider,
    normalise: (raw) => normaliseAustenderRelease(raw as Record<string, unknown>),
  },
  cppp: {
    provider: cpppProvider,
    normalise: (raw) => normaliseCpppRow(raw as Record<string, unknown>),
  },
  nocopo: {
    provider: nocopoProvider,
    normalise: (raw) => normaliseNocopoRow(raw as Record<string, unknown>),
  },
  ppip: {
    provider: ppipProvider,
    normalise: (raw) => normalisePpipTender(raw as Record<string, unknown>),
  },
  za_etenders: {
    provider: zaEtendersProvider,
    normalise: (raw) => normaliseZaEtendersRelease(raw as Record<string, unknown>),
  },
  ghaneps: {
    provider: ghanepsProvider,
    normalise: (raw) => normaliseGhanepsRow(raw as Record<string, unknown>),
  },
  etimad: {
    provider: etimadProvider,
    normalise: (raw) => normaliseEtimadTender(raw as Record<string, unknown>),
  },
  ted: {
    provider: tedProvider,
    normalise: (raw) => normaliseTedNotice(raw as Record<string, unknown>),
  },
  world_bank: {
    provider: worldBankProvider,
    normalise: (raw) => normaliseWorldBankNotice(raw as Record<string, unknown>),
  },
  ungm: {
    provider: ungmProvider,
    normalise: (raw) => normaliseUngmRow(raw as Record<string, unknown>),
  },
  afdb: {
    provider: afdbProvider,
    normalise: (raw) => normaliseAfdbRow(raw as Record<string, unknown>),
  },
  adb: {
    provider: adbProvider,
    normalise: (raw) => normaliseAdbRow(raw as Record<string, unknown>),
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
