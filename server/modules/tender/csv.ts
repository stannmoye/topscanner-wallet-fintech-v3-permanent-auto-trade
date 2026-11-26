/**
 * Tender Bid — minimal RFC 4180 CSV reader.
 *
 * CanadaBuys (and other open-data portals) publish tender notices as CSV. A small
 * quote-aware parser keeps that source dependency-free: it handles quoted fields,
 * escaped quotes (`""`), embedded newlines, and both LF and CRLF line endings.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let hasContent = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    // Drop a trailing empty line produced by a final newline.
    if (hasContent || row.some((value) => value.length > 0)) rows.push(row);
    row = [];
    hasContent = false;
  };

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      hasContent = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      pushRow();
    } else {
      field += char;
      hasContent = true;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
}

/** Turn parsed rows into header-keyed records, skipping blank rows. */
export function csvRowsToObjects(rows: string[][]): Record<string, string>[] {
  if (rows.length < 2) return [];
  const header = rows[0].map((column) => column.trim());
  const records: Record<string, string>[] = [];
  for (const row of rows.slice(1)) {
    if (row.length === 1 && row[0].trim() === "") continue;
    const record: Record<string, string> = {};
    for (let index = 0; index < header.length; index++) {
      record[header[index]] = (row[index] ?? "").trim();
    }
    records.push(record);
  }
  return records;
}

/**
 * Find a CSV value whose header contains all of the supplied tokens (case
 * insensitive). Open-data portals vary in whether a column is `field`, `field-eng`,
 * or `english-title-french-title`, so token matching is more robust than exact keys.
 */
export function findCsvValue(record: Record<string, string>, ...tokens: string[]): string | null {
  const lowerTokens = tokens.map((token) => token.toLowerCase());
  for (const [key, value] of Object.entries(record)) {
    const lowerKey = key.toLowerCase();
    if (lowerTokens.every((token) => lowerKey.includes(token)) && value.trim()) return value.trim();
  }
  return null;
}
