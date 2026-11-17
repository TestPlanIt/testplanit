import Papa from "papaparse";

/**
 * Audit log cells hold user-controlled text (entity names, user agents,
 * metadata), so `escapeFormulae` neutralises values a spreadsheet would
 * otherwise run as a formula.
 */
export function buildAuditLogCsv(headers: string[], rows: string[][]): string {
  return Papa.unparse(
    { fields: headers, data: rows },
    { escapeFormulae: true }
  );
}
