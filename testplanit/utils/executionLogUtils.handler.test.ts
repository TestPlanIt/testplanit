import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockedDb, sqlCalls } = vi.hoisted(() => ({
  mockedDb: {
    testRunResults: {
      count: vi.fn(async () => 0),
      groupBy: vi.fn(async () => []),
      findMany: vi.fn(async () => []),
    },
    jUnitTestResult: {
      count: vi.fn(async () => 0),
      groupBy: vi.fn(async () => []),
    },
    status: { findMany: vi.fn(async () => []) },
    $qb: {},
  },
  // The log query is raw SQL; capture the statement's text and parameters.
  sqlCalls: [] as Array<{ text: string; values: unknown[] }>,
}));
vi.mock("@/lib/db", () => ({ baseDb: mockedDb }));

vi.mock("kysely", () => {
  type Fragment = { strings: readonly string[]; values: unknown[] };
  // Render a fragment to text, inlining nested fragments and numbering
  // every parameter into one flat list, the way the driver would.
  const render = (frag: Fragment, flat: unknown[]): string =>
    frag.strings.reduce((acc, part, i) => {
      if (i >= frag.values.length) return acc + part;
      const v = frag.values[i];
      if (v && typeof v === "object" && "strings" in (v as any)) {
        return acc + part + render(v as Fragment, flat);
      }
      flat.push(v);
      return `${acc}${part}$${flat.length - 1}`;
    }, "");
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const fragment: Fragment & { execute: () => Promise<{ rows: [] }> } = {
      strings,
      values,
      execute: async () => {
        const flat: unknown[] = [];
        const text = render(fragment, flat);
        sqlCalls.push({ text, values: flat });
        return { rows: [] };
      },
    };
    return fragment;
  };
  (sql as any).raw = (s: string) => ({ strings: [s], values: [] });
  return { sql };
});

vi.mock("~/utils/reportApiUtils", () => ({
  authorizeReportRequest: vi.fn(async () => ({ ok: true, bypass: false })),
}));

import { handleExecutionLogPOST } from "~/utils/executionLogUtils";

const post = (body: Record<string, unknown>) =>
  new NextRequest("http://localhost/api/report-builder/execution-log", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

// The window the main statement ran with, read from the captured values.
function windowOf(text: string, values: unknown[]) {
  const m = /LIMIT \$(\d+) OFFSET \$(\d+)/.exec(text);
  if (!m) return null;
  return { limit: values[Number(m[1])], offset: values[Number(m[2])] };
}

describe("handleExecutionLogPOST paging window", () => {
  beforeEach(() => {
    sqlCalls.length = 0;
    delete process.env.REPORT_SNAPSHOT_MAX_ROWS;
  });

  it("caps pageSize 'All' at the frozen-report row cap instead of dropping the window", async () => {
    const res = await handleExecutionLogPOST(
      post({ projectId: 1, pageSize: "All" }),
      false
    );
    expect(res.status).toBe(200);
    const main = sqlCalls.find((c) => /LIMIT/.test(c.text));
    expect(main, "main statement has a window").toBeTruthy();
    expect(windowOf(main!.text, main!.values)).toEqual({
      limit: 10000,
      offset: 0,
    });
  });

  it("follows REPORT_SNAPSHOT_MAX_ROWS for 'All'", async () => {
    process.env.REPORT_SNAPSHOT_MAX_ROWS = "250";
    await handleExecutionLogPOST(
      post({ projectId: 1, pageSize: "All" }),
      false
    );
    const main = sqlCalls.find((c) => /LIMIT/.test(c.text))!;
    expect(windowOf(main.text, main.values)).toEqual({ limit: 250, offset: 0 });
  });

  it("keeps the numeric page window clamped to 200 with its offset", async () => {
    await handleExecutionLogPOST(
      post({ projectId: 1, page: 3, pageSize: 500 }),
      false
    );
    const main = sqlCalls.find((c) => /LIMIT/.test(c.text))!;
    expect(windowOf(main.text, main.values)).toEqual({
      limit: 200,
      offset: 400,
    });
  });
});
