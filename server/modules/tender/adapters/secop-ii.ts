import type { NormalizedTender, RawTenderPage, TenderFetchParams, TenderProvider } from "../provider";
import { fetchJson } from "../http";
import {
  TENDER_COLUMN_LIMITS,
  canonicalIndustry,
  normaliseCurrencyCode,
  normaliseWhitespace,
  pickString,
  toIsoString,
  toMinorUnits,
  truncate,
} from "../normalise";

/**
 * Colombia — SECOP II (Sistema Electronico de Contratacion Publica).
 *
 * Colombia publishes SECOP II open data through Socrata at
 * `GET https://www.datos.gov.co/resource/p6dx-8zbt.json` (the "SECOP II -
 * Procesos de Contratacion" dataset). It supports Socrata SoQL paging
 * (`$limit`, `$offset`) and ordering (`$order=<field> DESC`); the response is a
 * plain array of rows. Each row carries `id_del_proceso`,
 * `referencia_del_proceso`, `nombre_del_procedimiento`,
 * `descripci_n_del_procedimiento`, `entidad`, `precio_base` (COP),
 * `modalidad_de_contratacion`, `estado_del_procedimiento`,
 * `fecha_de_publicacion_del` and a Socrata URL object `urlproceso.{url}`. No key
 * is required. A payload that is not the documented array shape yields nothing.
 */
export const SECOP_II_PROCESOS_URL = "https://www.datos.gov.co/resource/p6dx-8zbt.json";
const SECOP_II_PORTAL_URL = "https://www.colombiacompra.gov.co/secop/secop-ii";
const SECOP_II_PAGE_SIZE = 100;
const SECOP_II_ORDER_FIELD = "fecha_de_publicacion_del";

/** Read the row array from a Socrata payload (never fabricates entries). */
export function readSecopIiRows(payload: unknown): Record<string, unknown>[] {
  return Array.isArray(payload) ? (payload as Record<string, unknown>[]) : [];
}

/** The first usable URL out of a Socrata URL field (string or `{ url }`). */
function socrataUrl(value: unknown): string | null {
  if (typeof value === "string") return pickString(value);
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  return record ? pickString(record.url) : null;
}

export async function fetchSecopIiPage(params: TenderFetchParams): Promise<RawTenderPage> {
  const offset = Number.parseInt(params.cursor ?? "0", 10);
  const safeOffset = Number.isFinite(offset) && offset > 0 ? offset : 0;

  const url = new URL(SECOP_II_PROCESOS_URL);
  url.searchParams.set("$limit", String(SECOP_II_PAGE_SIZE));
  url.searchParams.set("$offset", String(safeOffset));
  url.searchParams.set("$order", `${SECOP_II_ORDER_FIELD} DESC`);

  const payload = await fetchJson<unknown>(url.toString());
  const items = readSecopIiRows(payload);
  const nextCursor = items.length === SECOP_II_PAGE_SIZE ? String(safeOffset + items.length) : null;
  return { items, nextCursor };
}

/** Normalise one SECOP II process, or null when it has no usable identity. */
export function normaliseSecopIiProcess(raw: Record<string, unknown>): NormalizedTender | null {
  const externalId = pickString(raw.id_del_proceso, raw.referencia_del_proceso);
  if (!externalId) return null;
  const title = pickString(raw.nombre_del_procedimiento, raw.descripci_n_del_procedimiento, externalId);
  if (!title) return null;
  const sourceUrl = socrataUrl(raw.urlproceso) ?? SECOP_II_PORTAL_URL;
  const amountMinor = toMinorUnits(raw.precio_base, 2);

  return {
    externalId: truncate(externalId, TENDER_COLUMN_LIMITS.externalId)!,
    countryCode: "CO",
    title: truncate(title, TENDER_COLUMN_LIMITS.title)!,
    buyer: truncate(normaliseWhitespace(pickString(raw.entidad)), TENDER_COLUMN_LIMITS.buyer),
    buyerType: null,
    industry: canonicalIndustry({ categoryName: pickString(raw.tipo_de_contrato) }),
    tenderType: truncate(pickString(raw.tipo_de_contrato), TENDER_COLUMN_LIMITS.tenderType),
    procedure: truncate(pickString(raw.modalidad_de_contratacion, raw.estado_del_procedimiento), TENDER_COLUMN_LIMITS.procedure),
    contractAmountMinor: amountMinor,
    contractCurrency: amountMinor == null ? null : normaliseCurrencyCode("COP"),
    bidOpenAt: toIsoString(raw.fecha_de_publicacion_del),
    bidCloseAt: toIsoString(raw.fecha_de_recepcion_de ?? raw.fecha_de_apertura_de_respuesta ?? raw.fecha_de_ultima_publicaci),
    payoutAt: null,
    publishedAt: toIsoString(raw.fecha_de_publicacion_del),
    summary: truncate(normaliseWhitespace(pickString(raw.descripci_n_del_procedimiento, raw.nombre_del_procedimiento)), TENDER_COLUMN_LIMITS.summary),
    descriptionText: normaliseWhitespace(pickString(raw.descripci_n_del_procedimiento)),
    documents: [],
    sourceUrl: truncate(sourceUrl, TENDER_COLUMN_LIMITS.sourceUrl)!,
    raw,
  };
}

export const secopIiProvider: TenderProvider = {
  key: "secop_ii",
  countryCode: "CO",
  kind: "government",
  fetch: fetchSecopIiPage,
};
