import type { NormalizedTender, TenderProvider } from "../provider";
import { createOpenDataSoftProvider, openDataSoftSinceClause } from "./opendatasoft";
import {
  TENDER_COLUMN_LIMITS,
  canonicalIndustry,
  normaliseWhitespace,
  pickString,
  toIsoString,
  truncate,
} from "../normalise";

/**
 * France — BOAMP (Bulletin officiel des annonces des marchés publics), published
 * by DILA through the OpenDataSoft Explore API v2.1.
 *
 * `GET https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records`
 * is open (no key). Each record carries the notice's own identity (`idweb`, `id`),
 * its object (`objet`), the buyer (`nomacheteur`), the publication/response dates
 * (`dateparution`, `datelimitereponse`), the notice type (`type_marche_facette`)
 * and a customer-facing notice URL (`url_avis`, e.g.
 * `https://www.boamp.fr/pages/avis/?q=idweb:26-113929`). BOAMP does not publish a
 * contract value, so no amount is fabricated and the USD value stays null.
 */
export const BOAMP_RECORDS_URL = "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records";
const BOAMP_ORDER_BY = "dateparution";
const BOAMP_NOTICE_URL = "https://www.boamp.fr/pages/avis/";

export const boampProvider: TenderProvider = createOpenDataSoftProvider({
  key: "boamp",
  countryCode: "FR",
  kind: "government",
  endpoint: BOAMP_RECORDS_URL,
  orderBy: BOAMP_ORDER_BY,
  pageSize: 100,
  maxRecords: 500,
  buildWhere: (params) => openDataSoftSinceClause(BOAMP_ORDER_BY, params),
});

/** The first non-empty string in a value that may be a plain value or a list. */
function firstOfList(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = pickString(item);
      if (found) return found;
    }
    return null;
  }
  return pickString(value);
}

/** Normalise one BOAMP record, or null when it has no identity. */
export function normaliseBoampRecord(raw: Record<string, unknown>): NormalizedTender | null {
  const externalId = pickString(raw.idweb, raw.id, raw.contractfolderid);
  if (!externalId) return null;
  const title = pickString(raw.objet, raw.filename, externalId);
  if (!title) return null;

  const sourceUrl = pickString(raw.url_avis) ?? `${BOAMP_NOTICE_URL}?q=idweb:${encodeURIComponent(externalId)}`;
  const buyer = firstOfList(raw.nomacheteur);
  const procedure = firstOfList(raw.procedure_libelle) ?? firstOfList(raw.nature_libelle);
  const tenderType = firstOfList(raw.type_marche_facette) ?? firstOfList(raw.type_marche);
  const industry = canonicalIndustry({ categoryName: firstOfList(raw.descripteur_libelle) });

  return {
    externalId: truncate(externalId, TENDER_COLUMN_LIMITS.externalId)!,
    countryCode: "FR",
    title: truncate(title, TENDER_COLUMN_LIMITS.title)!,
    buyer: truncate(normaliseWhitespace(buyer), TENDER_COLUMN_LIMITS.buyer),
    buyerType: null,
    industry,
    tenderType: truncate(tenderType, TENDER_COLUMN_LIMITS.tenderType),
    procedure: truncate(procedure, TENDER_COLUMN_LIMITS.procedure),
    contractAmountMinor: null,
    contractCurrency: null,
    bidOpenAt: null,
    bidCloseAt: toIsoString(raw.datelimitereponse),
    payoutAt: null,
    publishedAt: toIsoString(raw.dateparution),
    summary: truncate(normaliseWhitespace(title), TENDER_COLUMN_LIMITS.summary),
    descriptionText: null,
    documents: [],
    sourceUrl: truncate(sourceUrl, TENDER_COLUMN_LIMITS.sourceUrl)!,
    raw,
  };
}
