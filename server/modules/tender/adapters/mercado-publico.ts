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
 * Chile — Mercado Publico (ChileCompra).
 *
 * `GET https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json`
 * with `estado=publicada` and a `ticket` (the ChileCompra API key, read from
 * `CHILECOMPRA_TICKET`) is the documented public licitaciones feed. The response
 * is `{ Cantidad, Listado: [ … ] }`; each row carries `CodigoExterno`, `Nombre`,
 * `Descripcion`, `FechaPublicacion`, `FechaCierre`, `Estado`,
 * `Comprador.NombreOrganismo` and `MontoEstimado` (CLP). When no ticket is
 * configured the provider refuses rather than fetching anonymously, and the
 * worker records the source as unhealthy (fail closed). The notice page is
 * `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=<code>`.
 */
export const CHILECOMPRA_LICITACIONES_URL = "https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json";
const CHILECOMPRA_DETAIL_URL = "https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx";

type ChileCompraResponse = {
  Listado?: Record<string, unknown>[];
};

/** Read the licitacion array from a ChileCompra payload (never fabricates entries). */
export function readChileMercadoPublico(payload: unknown): Record<string, unknown>[] {
  const listado = (payload as { Listado?: unknown })?.Listado;
  return Array.isArray(listado) ? (listado as Record<string, unknown>[]) : [];
}

function readTicket(): string {
  const ticket = process.env.CHILECOMPRA_TICKET?.trim();
  if (!ticket) throw new Error("ChileCompra API ticket is not configured (CHILECOMPRA_TICKET).");
  return ticket;
}

export async function fetchChileMercadoPublicoPage(params: TenderFetchParams): Promise<RawTenderPage> {
  const ticket = readTicket();
  const page = Math.max(Number.parseInt(params.cursor ?? "1", 10) || 1, 1);
  const url = new URL(CHILECOMPRA_LICITACIONES_URL);
  url.searchParams.set("estado", "publicada");
  url.searchParams.set("ticket", ticket);
  url.searchParams.set("pagina", String(page));

  const payload = await fetchJson<ChileCompraResponse>(url.toString());
  const items = readChileMercadoPublico(payload);
  return { items, nextCursor: items.length > 0 ? String(page + 1) : null };
}

/** Normalise one Mercado Publico licitacion, or null when it has no usable identity. */
export function normaliseChileMercadoPublico(raw: Record<string, unknown>): NormalizedTender | null {
  const externalId = pickString(raw.CodigoExterno, raw.Codigo);
  if (!externalId) return null;
  const title = pickString(raw.Nombre, externalId);
  if (!title) return null;

  const buyer = (raw.Comprador ?? {}) as Record<string, unknown>;
  const sourceUrl = `${CHILECOMPRA_DETAIL_URL}?idlicitacion=${encodeURIComponent(externalId)}`;
  // CLP has no minor unit, so the whole-peso amount is stored with scale 0.
  const amountMinor = toMinorUnits(raw.MontoEstimado, 0);

  return {
    externalId: truncate(externalId, TENDER_COLUMN_LIMITS.externalId)!,
    countryCode: "CL",
    title: truncate(title, TENDER_COLUMN_LIMITS.title)!,
    buyer: truncate(normaliseWhitespace(pickString(buyer.NombreOrganismo, buyer.NombreUsuario)), TENDER_COLUMN_LIMITS.buyer),
    buyerType: null,
    industry: canonicalIndustry({ categoryName: pickString(raw.Tipo, raw.TipoConvocatoria) }),
    tenderType: truncate(pickString(raw.TipoConvocatoria, raw.Tipo), TENDER_COLUMN_LIMITS.tenderType),
    procedure: truncate(pickString(raw.Estado), TENDER_COLUMN_LIMITS.procedure),
    contractAmountMinor: amountMinor,
    contractCurrency: amountMinor == null ? null : normaliseCurrencyCode("CLP"),
    bidOpenAt: toIsoString(raw.FechaPublicacion),
    bidCloseAt: toIsoString(raw.FechaCierre),
    payoutAt: null,
    publishedAt: toIsoString(raw.FechaPublicacion),
    summary: truncate(normaliseWhitespace(pickString(raw.Descripcion, raw.Nombre)), TENDER_COLUMN_LIMITS.summary),
    descriptionText: normaliseWhitespace(pickString(raw.Descripcion)),
    documents: [],
    sourceUrl: truncate(sourceUrl, TENDER_COLUMN_LIMITS.sourceUrl)!,
    raw,
  };
}

export const mercadoPublicoProvider: TenderProvider = {
  key: "mercado_publico",
  countryCode: "CL",
  kind: "government",
  fetch: fetchChileMercadoPublicoPage,
};
