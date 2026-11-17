import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { buildAuditLogCsv } from "./auditLogCsv";

const parse = (csv: string) =>
  Papa.parse<string[]>(csv, { skipEmptyLines: true }).data;

describe("buildAuditLogCsv", () => {
  it("neutralises cells a spreadsheet would run as a formula", () => {
    const csv = buildAuditLogCsv(
      ["Entity", "User agent"],
      [
        ['=HYPERLINK("http://evil.test")', "+cmd|' /C calc'!A0"],
        ["@SUM(A1)", "-2+3"],
      ]
    );

    const [, first, second] = parse(csv);
    expect(first).toEqual([
      '\'=HYPERLINK("http://evil.test")',
      "'+cmd|' /C calc'!A0",
    ]);
    expect(second).toEqual(["'@SUM(A1)", "'-2+3"]);
  });

  it("round-trips commas, quotes and newlines unchanged", () => {
    const row = ['Case "A", copy', "line one\nline two", '{"ip":"10.0.0.1"}'];

    const csv = buildAuditLogCsv(["Name", "Notes", "Metadata"], [row]);

    expect(parse(csv)).toEqual([["Name", "Notes", "Metadata"], row]);
  });

  it("writes the header row first and one line per log", () => {
    const csv = buildAuditLogCsv(
      ["Timestamp", "Action"],
      [
        ["2026-11-11 08:00:00", "CREATE"],
        ["2026-11-11 08:00:01", "UPDATE"],
      ]
    );

    expect(csv).toBe(
      "Timestamp,Action\r\n2026-11-11 08:00:00,CREATE\r\n2026-11-11 08:00:01,UPDATE"
    );
  });

  it("keeps empty cells so columns stay aligned", () => {
    const csv = buildAuditLogCsv(["A", "B", "C"], [["", "x", ""]]);

    expect(parse(csv)[1]).toEqual(["", "x", ""]);
  });

  it("reads back the same cells as the previous hand-written export", () => {
    // The exporter this helper replaced, kept as the reference for ordinary
    // (non-formula) audit data.
    const previousExport = (headers: string[], rows: string[][]) => {
      const escapeCsvValue = (value: string) =>
        value.includes(",") || value.includes('"') || value.includes("\n")
          ? `"${value.replace(/"/g, '""')}"`
          : value;
      return [
        headers.map(escapeCsvValue).join(","),
        ...rows.map((row) => row.map(escapeCsvValue).join(",")),
      ].join("\n");
    };

    const headers = [
      "Timestamp",
      "Action",
      "Entity Type",
      "Entity ID",
      "Entity Name",
      "User",
      "Email",
      "Project",
      "IP Address",
      "User Agent",
      "Metadata",
    ];
    const rows = [
      [
        "2026-11-11 08:00:00",
        "CREATE",
        "RepositoryCases",
        "4812",
        'Login, "happy path"',
        "Ada Lovelace",
        "ada@example.test",
        "Checkout — Web",
        "203.0.113.7",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)",
        '{"ipAddress":"203.0.113.7","changes":{"name":{"old":"a","new":"b, c"}}}',
      ],
      [
        "2026-11-11 08:00:01",
        "BULK_DELETE",
        "Tags",
        "",
        "smoke\nregression",
        "System",
        "",
        "",
        "",
        "",
        "",
      ],
      [
        "2026-11-11 08:00:02",
        "UPDATE",
        "User",
        "clx9z0001",
        "Zoë Ünïcode 測試 🎉",
        "zoe",
        "zoe@example.test",
        "",
        "2001:db8::1",
        "curl/8.7.1",
        '{"note":"it\'s fine"}',
      ],
    ];

    expect(parse(buildAuditLogCsv(headers, rows))).toEqual(
      parse(previousExport(headers, rows))
    );
  });
});
