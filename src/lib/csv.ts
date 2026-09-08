// Minimal, correct CSV building (Step 19). No dependency — the escaping
// rule itself is small enough that adding a package for it would be the
// "unnecessary dependency" the brief warns against.
//
// RFC 4180 escaping: a field is wrapped in double quotes, with any
// internal double quote doubled, whenever it contains a comma, a quote,
// or a newline (\n or \r). Every other field is left bare. Rows are
// joined with CRLF, the line ending spreadsheet software (Excel in
// particular) expects.
//
// Phase 12 (Production Hardening §3/§18) — CSV formula-injection guard:
// a field beginning with =, +, -, or @ is interpreted as a FORMULA by
// Excel/Sheets/LibreOffice when the exported file is opened, not as
// plain text (the well-known "CSV injection" class of issue). A
// leading apostrophe forces spreadsheet software to treat the cell as
// literal text instead, and is invisible in the cell's displayed value.
// Safe for every field this app actually exports: no money amount in
// this system is ever negative (money.ts's MONEY_REGEX has no leading
// "-" at all — balanceAmount is always total-minus-advance with
// advance already constrained <= total), so this can never mistakenly
// mangle a legitimate negative number; it only ever affects a
// name/address/tagline field that happens to start with one of these
// characters.
const FORMULA_INJECTION_PREFIX = /^[=+\-@]/;

function escapeCsvField(value: string): string {
  const guarded = FORMULA_INJECTION_PREFIX.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

export function toCsvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map((field) => escapeCsvField(field === null || field === undefined ? "" : String(field))).join(",");
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  return [toCsvRow(header), ...rows.map(toCsvRow)].join("\r\n");
}
