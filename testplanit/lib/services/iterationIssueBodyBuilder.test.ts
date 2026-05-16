import { describe, expect, it, vi } from "vitest";
import {
  buildIterationIssueBody,
  type PrismaLike,
} from "./iterationIssueBodyBuilder";

// ── Test helpers ──────────────────────────────────────────────────────
//
// `buildIterationIssueBody` accepts a tiny `client` shape so tests can
// mock the database surface without spinning up Prisma. The shape matches
// just the fields/methods the helper consumes.

function makeClient(opts: {
  iteration?: any;
  totalIterations?: number;
}): PrismaLike {
  return {
    testRunCaseIteration: {
      // WR-03: builder switched from findUnique → findFirst so the
      // `isDeleted: false` predicate can compose with the id lookup.
      findFirst: vi.fn(async () => opts.iteration ?? null),
      count: vi.fn(async () => opts.totalIterations ?? 0),
    } as any,
  };
}

// Schema fixture: 3 params, one sensitive (password)
const baseSchema = [
  { name: "username", sensitive: false, type: "STRING" },
  { name: "password", sensitive: true, type: "STRING" },
  { name: "expectedRole", sensitive: false, type: "STRING" },
];

function makeIterationFixture(overrides: Partial<any> = {}) {
  return {
    id: 999,
    rowIndex: 2, // 0-based → iteration N = 3
    label: "Bad password",
    valuesJson: {
      username: "alice@example.com",
      password: "s3cret",
      expectedRole: "admin",
    },
    ciExtended: false,
    testRunCase: {
      id: 77,
      testRunId: 42,
      repositoryCase: {
        name: "Login with bad password",
      },
      testRun: {
        id: 42,
        projectId: 7,
      },
      dataSetSnapshot: {
        parametersJson: baseSchema,
      },
    },
    ...overrides,
  };
}

describe("buildIterationIssueBody", () => {
  it("builds title with 'Iteration N of M failed: <case name>' for snapshot-born iterations", async () => {
    const client = makeClient({
      iteration: makeIterationFixture(),
      totalIterations: 5,
    });

    const result = await buildIterationIssueBody({
      iterationId: 999,
      viewerCanReadSensitive: true,
      client,
    });

    expect(result.title).toBe(
      "Iteration 3 of 5 failed: Login with bad password"
    );
  });

  it("ciExtended iteration omits 'of M' and notes CI-extended", async () => {
    const client = makeClient({
      iteration: makeIterationFixture({
        ciExtended: true,
        // ciExtended rows have no snapshot
        testRunCase: {
          id: 77,
          testRunId: 42,
          repositoryCase: { name: "Login flow" },
          testRun: { id: 42, projectId: 7 },
          dataSetSnapshot: null,
        },
      }),
      totalIterations: 10,
    });

    const result = await buildIterationIssueBody({
      iterationId: 999,
      viewerCanReadSensitive: true,
      client,
    });

    expect(result.title).toBe(
      "Iteration 3 (CI-extended) failed: Login flow"
    );
  });

  it("description is a TipTap doc with prose lead + parameter table + deep link", async () => {
    const client = makeClient({
      iteration: makeIterationFixture(),
      totalIterations: 5,
    });

    const result = await buildIterationIssueBody({
      iterationId: 999,
      viewerCanReadSensitive: true,
      client,
    });

    const doc = result.description as any;
    expect(doc.type).toBe("doc");
    expect(Array.isArray(doc.content)).toBe(true);

    // Expect ≥ 3 blocks: lead paragraph, table, deep-link paragraph
    expect(doc.content.length).toBeGreaterThanOrEqual(3);

    // Table is present and has a header row + 3 body rows for the 3 params
    const table = doc.content.find((n: any) => n.type === "table");
    expect(table).toBeDefined();
    expect(table.content.length).toBe(4); // header + 3 rows
  });

  it("table contains all parameter values when viewer has READ_SENSITIVE", async () => {
    const client = makeClient({
      iteration: makeIterationFixture(),
      totalIterations: 5,
    });

    const result = await buildIterationIssueBody({
      iterationId: 999,
      viewerCanReadSensitive: true,
      client,
    });

    const doc = result.description as any;
    const table = doc.content.find((n: any) => n.type === "table");
    // Pluck text from each row's cells
    const rowText: string[][] = (table.content as any[]).map((row: any) =>
      (row.content as any[]).map((cell: any) =>
        (cell.content[0]?.content?.[0]?.text as string) ?? ""
      )
    );
    // First row is header
    expect(rowText[0]).toEqual(["Parameter", "Value"]);
    // Body rows include both names and values
    const flat = rowText.slice(1).flat();
    expect(flat).toContain("username");
    expect(flat).toContain("alice@example.com");
    expect(flat).toContain("password");
    expect(flat).toContain("s3cret"); // visible because viewer can read sensitive
    expect(flat).toContain("expectedRole");
    expect(flat).toContain("admin");
  });

  it("sensitive parameter shows [REDACTED] when viewerCanReadSensitive=false", async () => {
    const client = makeClient({
      iteration: makeIterationFixture(),
      totalIterations: 5,
    });

    const result = await buildIterationIssueBody({
      iterationId: 999,
      viewerCanReadSensitive: false,
      client,
    });

    const doc = result.description as any;
    const table = doc.content.find((n: any) => n.type === "table");
    const rowText: string[][] = (table.content as any[]).map((row: any) =>
      (row.content as any[]).map((cell: any) =>
        (cell.content[0]?.content?.[0]?.text as string) ?? ""
      )
    );
    const flat = rowText.slice(1).flat();
    expect(flat).toContain("[REDACTED]");
    expect(flat).not.toContain("s3cret");
    // Non-sensitive values are still present
    expect(flat).toContain("alice@example.com");
    expect(flat).toContain("admin");
  });

  it("deep link in trailing paragraph matches buildIterationDeepLink output", async () => {
    const client = makeClient({
      iteration: makeIterationFixture(),
      totalIterations: 5,
    });

    const result = await buildIterationIssueBody({
      iterationId: 999,
      viewerCanReadSensitive: true,
      client,
    });

    const doc = result.description as any;
    // Final block is a paragraph with a link mark
    const lastBlock = doc.content[doc.content.length - 1];
    expect(lastBlock.type).toBe("paragraph");
    const linkNode = lastBlock.content.find(
      (c: any) => c.marks && c.marks.some((m: any) => m.type === "link")
    );
    expect(linkNode).toBeDefined();
    const linkMark = linkNode.marks.find((m: any) => m.type === "link");
    expect(linkMark.attrs.href).toBe(
      "/projects/runs/7/42?iteration=3&selectedCase=77"
    );
  });

  it("empty parameter value renders as single space, not empty string", async () => {
    const client = makeClient({
      iteration: makeIterationFixture({
        valuesJson: {
          username: "",
          password: "x",
          expectedRole: "admin",
        },
      }),
      totalIterations: 5,
    });

    const result = await buildIterationIssueBody({
      iterationId: 999,
      viewerCanReadSensitive: true,
      client,
    });

    const doc = result.description as any;
    const table = doc.content.find((n: any) => n.type === "table");
    // Find the username row
    const usernameRow = (table.content as any[])
      .slice(1)
      .find((row: any) =>
        row.content.some(
          (cell: any) => cell.content[0]?.content?.[0]?.text === "username"
        )
      );
    // Value cell content should be a single space, not empty
    const valueCell = usernameRow.content[1];
    const valueText = valueCell.content[0]?.content?.[0]?.text;
    expect(valueText).toBe(" ");
  });

  it("prose lead uses iteration label when present", async () => {
    const client = makeClient({
      iteration: makeIterationFixture({ label: "Bad password" }),
      totalIterations: 5,
    });

    const result = await buildIterationIssueBody({
      iterationId: 999,
      viewerCanReadSensitive: true,
      client,
    });

    const doc = result.description as any;
    const lead = doc.content[0];
    expect(lead.type).toBe("paragraph");
    // Concatenate all text nodes
    const leadText = lead.content
      .map((n: any) => n.text ?? "")
      .join("");
    expect(leadText).toContain("Iteration 3 of 5 failed");
    expect(leadText).toContain("Bad password");
  });

  it("prose lead falls back to 'Row N' when label is null", async () => {
    const client = makeClient({
      iteration: makeIterationFixture({ label: null }),
      totalIterations: 5,
    });

    const result = await buildIterationIssueBody({
      iterationId: 999,
      viewerCanReadSensitive: true,
      client,
    });

    const doc = result.description as any;
    const lead = doc.content[0];
    const leadText = lead.content
      .map((n: any) => n.text ?? "")
      .join("");
    expect(leadText).toContain("Row 3");
  });

  it("throws when iteration not found", async () => {
    const client = makeClient({ iteration: null });

    await expect(
      buildIterationIssueBody({
        iterationId: 9999,
        viewerCanReadSensitive: true,
        client,
      })
    ).rejects.toThrow(/not found/i);
  });

  it("WR-03: findFirst includes `isDeleted: false` (consistent with sibling count query)", async () => {
    const client = makeClient({
      iteration: makeIterationFixture(),
      totalIterations: 3,
    });

    await buildIterationIssueBody({
      iterationId: 999,
      viewerCanReadSensitive: true,
      client,
    });

    const findFirstFn = (client.testRunCaseIteration as any).findFirst as ReturnType<
      typeof vi.fn
    >;
    expect(findFirstFn).toHaveBeenCalledTimes(1);
    const call = findFirstFn.mock.calls[0]![0];
    expect(call.where).toMatchObject({ id: 999, isDeleted: false });
  });
});
