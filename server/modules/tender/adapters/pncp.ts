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
 * Brazil — Portal Nacional de Contratacoes Publicas (PNCP).
 *
 * `GET https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao` is the
 * documented PNCP consulta endpoint (see
 * `https://pncp.gov.br/api/consulta/swagger-ui/index.html`). It requires
 * `dataInicial`/`dataFinal` (`YYYYMMDD`) and a `codigoModalidadeContratacao`
 * (the procurement modality enum), plus optional `pagina`/`tamanhoPagina`. The
 * response is `{ data: [ … ], totalRegistros, totalPaginas, numeroPagina,
 * paginasRestantes }`; each item carries `numeroCompra`, `anoCompra`,
 * `sequencialCompra`, `numeroControlePNCP`, `orgaoEntidade.{cnpj,razaoSocial}`,
 * `unidadeOrgao.nomeUnidade`, `objetoCompra`, `valorTotalEstimado` (BRL),
 * `dataPublicacaoPncp`, `dataAberturaProposta`, `dataEncerramentoProposta`,
 * `modalidadeNome`, `situacaoCompraNome` and `linkSistemaOrigem`.
 *
 * Because the modality is mandatory and there is no "all" value, the adapter
 * walks every documented modality one page at a time; the cursor is
 * `<modalityIndex>:<page>`. The public notice page is
 * `https://pncp.gov.br/app/editais/<cnpj>/<ano>/<sequencial>`. No key required.
 */
export const PNCP_CONTRATACOES_URL = "https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao";
const PNCP_EDITAL_URL = "https://pncp.gov.br/app/editais";
const PNCP_PAGE_SIZE = 50;
const PNCP_WINDOW_DAYS = 30;
/** The documented procurement-modality enum (`codigoModalidadeContratacao`). */
const PNCP_MODALITY_CODES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;

type PncpResponse = {
  data?: Record<string, unknown>[];
  paginasRestantes?: unknown;
};

/** Format an instant as the `YYYYMMDD` day PNCP expects. */
export function formatPncpDay(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

/** The publication window for a fetch, defaulting to the most recent 30 days. */
export function resolvePncpWindow(since: Date | undefined, now: Date): { dataInicial: string; dataFinal: string } {
  const lowerBound = new Date(now.getTime() - PNCP_WINDOW_DAYS * 86_400_000);
  const start = since && since > lowerBound ? since : lowerBound;
  return { dataInicial: formatPncpDay(start), dataFinal: formatPncpDay(now) };
}

/** Read the contraction array from a PNCP payload (never fabricates entries). */
export function readPncpContratacoes(payload: unknown): Record<string, unknown>[] {
  const data = (payload as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

/** Fetch one page of the PNCP feed, walking modalities then pages via the cursor. */
export async function fetchPncpPage(params: TenderFetchParams): Promise<RawTenderPage> {
  const match = /^(\d+):(\d+)$/.exec(params.cursor ?? "");
  const modalityIndex = Math.min(match ? Number(match[1]) : 0, PNCP_MODALITY_CODES.length - 1);
  const page = match ? Math.max(Number(match[2]), 1) : 1;
  const modality = PNCP_MODALITY_CODES[modalityIndex];
  const { dataInicial, dataFinal } = resolvePncpWindow(params.since, new Date());

  const url = new URL(PNCP_CONTRATACOES_URL);
  url.searchParams.set("dataInicial", dataInicial);
  url.searchParams.set("dataFinal", dataFinal);
  url.searchParams.set("codigoModalidadeContratacao", String(modality));
  url.searchParams.set("pagina", String(page));
  url.searchParams.set("tamanhoPagina", String(PNCP_PAGE_SIZE));

  const payload = await fetchJson<PncpResponse>(url.toString());
  const items = readPncpContratacoes(payload);
  const remaining = Number(payload.paginasRestantes ?? 0);
  let nextCursor: string | null = null;
  if (remaining > 0) nextCursor = `${modalityIndex}:${page + 1}`;
  else if (modalityIndex + 1 < PNCP_MODALITY_CODES.length) nextCursor = `${modalityIndex + 1}:1`;
  return { items, nextCursor };
}

/** Normalise one PNCP contratacao, or null when it has no usable identity. */
export function normalisePncpContratacao(raw: Record<string, unknown>): NormalizedTender | null {
  const organ = (raw.orgaoEntidade ?? {}) as Record<string, unknown>;
  const unit = (raw.unidadeOrgao ?? {}) as Record<string, unknown>;
  const cnpj = pickString(organ.cnpj);
  const year = pickString(raw.anoCompra);
  const sequential = pickString(raw.sequencialCompra);
  const externalId = pickString(raw.numeroControlePNCP, raw.numeroCompra)
    ?? [cnpj, year, sequential].filter(Boolean).join("-");
  if (!externalId) return null;
  const title = pickString(raw.objetoCompra, raw.numeroCompra, externalId);
  if (!title) return null;

  const sourceUrl = pickString(raw.linkSistemaOrigem)
    ?? (cnpj && year && sequential ? `${PNCP_EDITAL_URL}/${cnpj}/${year}/${sequential}` : null);
  if (!sourceUrl) return null;
  const amountMinor = toMinorUnits(raw.valorTotalEstimado, 2);

  return {
    externalId: truncate(externalId, TENDER_COLUMN_LIMITS.externalId)!,
    countryCode: "BR",
    title: truncate(title, TENDER_COLUMN_LIMITS.title)!,
    buyer: truncate(normaliseWhitespace(pickString(organ.razaoSocial, unit.nomeUnidade)), TENDER_COLUMN_LIMITS.buyer),
    buyerType: null,
    industry: canonicalIndustry({ categoryName: pickString(raw.tipoInstrumentoConvocatorioNome) }),
    tenderType: truncate(pickString(raw.modalidadeNome), TENDER_COLUMN_LIMITS.tenderType),
    procedure: truncate(pickString(raw.situacaoCompraNome), TENDER_COLUMN_LIMITS.procedure),
    contractAmountMinor: amountMinor,
    contractCurrency: amountMinor == null ? null : normaliseCurrencyCode("BRL"),
    bidOpenAt: toIsoString(raw.dataAberturaProposta),
    bidCloseAt: toIsoString(raw.dataEncerramentoProposta),
    payoutAt: null,
    publishedAt: toIsoString(raw.dataPublicacaoPncp ?? raw.dataInclusao),
    summary: truncate(normaliseWhitespace(pickString(raw.objetoCompra)), TENDER_COLUMN_LIMITS.summary),
    descriptionText: normaliseWhitespace(pickString(raw.objetoCompra)),
    documents: [],
    sourceUrl: truncate(sourceUrl, TENDER_COLUMN_LIMITS.sourceUrl)!,
    raw,
  };
}

export const pncpProvider: TenderProvider = {
  key: "pncp",
  countryCode: "BR",
  kind: "government",
  fetch: fetchPncpPage,
};
