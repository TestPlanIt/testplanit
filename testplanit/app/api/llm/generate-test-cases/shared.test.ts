import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  IssueAdapter,
  IssueComment,
  IssueData,
  LinkedIssueRef,
} from "~/lib/integrations/adapters/IssueAdapter";
import { parameterCreateSchema } from "~/lib/schemas/parameterSchema";
import {
  buildCommentsSection,
  buildExpandUserPrompt,
  buildLinkedIssuesSection,
  buildOutlineSystemPrompt,
  buildOutlineUserPrompt,
  buildSystemPrompt,
  fetchExistingCasesContext,
  fetchIssueLinkedCasesContext,
  fetchLinkedIssuesContext,
  parseAndValidateTestCases,
  type GenerationContext,
  type LinkedIssueContext,
  type TemplateData,
  type IssueData as LlmIssueData,
} from "./shared";

type MockOpts = {
  linked?: LinkedIssueRef[];
  issues?: Record<string, Partial<IssueData>>;
  comments?: Record<string, IssueComment[]>;
  throwOn?: "getLinkedIssues" | "getIssue" | "getIssueComments";
  /** Per-id throw flags for finer control. */
  throwOnIssueIds?: string[];
  throwOnCommentsIds?: string[];
  omitGetLinkedIssues?: boolean;
};

function makeMockAdapter(opts: MockOpts): IssueAdapter {
  const adapter: Partial<IssueAdapter> = {};

  if (!opts.omitGetLinkedIssues) {
    adapter.getLinkedIssues = vi.fn(async (_issueId: string) => {
      if (opts.throwOn === "getLinkedIssues") {
        throw new Error("simulated getLinkedIssues failure");
      }
      return opts.linked ?? [];
    });
  }

  adapter.getIssue = vi.fn(async (issueId: string) => {
    if (
      opts.throwOn === "getIssue" ||
      opts.throwOnIssueIds?.includes(issueId)
    ) {
      throw new Error(`simulated getIssue failure for ${issueId}`);
    }
    const stub = opts.issues?.[issueId];
    return {
      id: issueId,
      title: stub?.title ?? `Title for ${issueId}`,
      description: stub?.description,
      status: stub?.status ?? "Open",
      priority: stub?.priority,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    } as IssueData;
  });

  adapter.getIssueComments = vi.fn(async (issueId: string) => {
    if (
      opts.throwOn === "getIssueComments" ||
      opts.throwOnCommentsIds?.includes(issueId)
    ) {
      throw new Error(`simulated getIssueComments failure for ${issueId}`);
    }
    return opts.comments?.[issueId] ?? [];
  });

  return adapter as unknown as IssueAdapter;
}

describe("fetchLinkedIssuesContext", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("happy path within budget — returns all linked issues with bodies and comments", async () => {
    const refs: LinkedIssueRef[] = [
      { id: "PROJ-2", key: "PROJ-2", linkType: "blocks", direction: "outward" },
      {
        id: "PROJ-3",
        key: "PROJ-3",
        linkType: "relates to",
        direction: "inward",
      },
    ];

    const adapter = makeMockAdapter({
      linked: refs,
      issues: {
        "PROJ-2": { title: "Title 2", description: "Body 2" },
        "PROJ-3": { title: "Title 3", description: "Body 3" },
      },
      comments: {
        "PROJ-2": [
          { author: "alice", body: "comment a", created: "2026-01-01" },
        ],
        "PROJ-3": [{ author: "bob", body: "comment b", created: "2026-01-02" }],
      },
    });

    const result = await fetchLinkedIssuesContext(adapter, "PROJ-1", 1000);

    expect(result.included).toHaveLength(2);
    expect(result.dropped).toHaveLength(0);
    expect(result.included[0].ref.id).toBe("PROJ-2");
    expect(result.included[0].title).toBe("Title 2");
    expect(result.included[0].body).toBe("Body 2");
    expect(result.included[0].comments).toHaveLength(1);
    expect(result.included[0].comments[0].body).toBe("comment a");
    expect(result.included[1].ref.id).toBe("PROJ-3");
    expect(result.included[1].body).toBe("Body 3");
    expect(result.tokensUsed).toBeGreaterThan(0);
    expect(result.tokensUsed).toBeLessThanOrEqual(1000);

    expect(adapter.getLinkedIssues).toHaveBeenCalledTimes(1);
    expect(adapter.getLinkedIssues).toHaveBeenCalledWith("PROJ-1");
    expect(adapter.getIssue).toHaveBeenCalledTimes(2);
    expect(adapter.getIssueComments).toHaveBeenCalledTimes(2);
  });

  it("drops one comment at a time when over budget — body preserved, dropped stays empty", async () => {
    // 1 linked ref. Body 100 chars + 3 comments × 200 chars each.
    // Title 10 chars + body 100 chars + comments-bodies-concat 600 chars = 710 chars.
    // tokensUsed = ceil(710/4) = 178.
    // Set budget = 150 -> at least one comment must drop, but the issue stays.
    const body100 = "b".repeat(100);
    const cmt200 = (label: string) => label.repeat(200);

    const refs: LinkedIssueRef[] = [
      { id: "PROJ-X", key: "PROJ-X", linkType: "blocks", direction: "outward" },
    ];
    const adapter = makeMockAdapter({
      linked: refs,
      issues: { "PROJ-X": { title: "TitleXXXXX", description: body100 } },
      comments: {
        "PROJ-X": [
          { author: "u", body: cmt200("a"), created: "" },
          { author: "u", body: cmt200("b"), created: "" },
          { author: "u", body: cmt200("c"), created: "" },
        ],
      },
    });

    const result = await fetchLinkedIssuesContext(adapter, "PROJ-1", 150);

    expect(result.included).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
    expect(result.included[0].body).toBe(body100);
    expect(result.included[0].comments.length).toBeLessThan(3);
    expect(result.tokensUsed).toBeLessThanOrEqual(150);
  });

  it("drops whole linked issue in tracker iteration order — last-returned first per D-04", async () => {
    // tracker iteration order — last-returned first per D-04
    // Two refs in this order: [refA, refB]. Both have empty comments.
    // Both bodies fit individually but not together. Budget = 30 tokens.
    //
    // refA: title 4 chars + body 100 chars = 104 chars -> 26 tokens.
    // refB: title 4 chars + body 100 chars = 104 chars -> 26 tokens.
    // Combined: 52 tokens. Budget 30 -> exactly one fits.
    //
    // If implementation drops last-returned-first (correct), refB drops, refA stays.
    // If implementation drops first-returned-first (wrong), this test fails.
    const body100 = "x".repeat(100);

    const refs: LinkedIssueRef[] = [
      { id: "REF-A", key: "REF-A", linkType: "blocks", direction: "outward" },
      { id: "REF-B", key: "REF-B", linkType: "blocks", direction: "outward" },
    ];
    const adapter = makeMockAdapter({
      linked: refs,
      issues: {
        "REF-A": { title: "AAAA", description: body100 },
        "REF-B": { title: "BBBB", description: body100 },
      },
      comments: { "REF-A": [], "REF-B": [] },
    });

    const result = await fetchLinkedIssuesContext(adapter, "PROJ-1", 30);

    expect(result.included).toHaveLength(1);
    expect(result.included[0].ref.id).toBe("REF-A");
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].id).toBe("REF-B");
  });

  it("drops comments from the linked issue with the largest comment count first (D-04 within-linked-issue)", async () => {
    // Two refs, equal title + body. Ref A has 2 comments, Ref B has 1.
    // Budget set so exactly ONE comment must drop. Rule: drop from the issue
    // with the largest comment count first => the dropped comment comes from ref A.
    const body50 = "b".repeat(50);
    const cmt40 = "c".repeat(40);

    const refs: LinkedIssueRef[] = [
      { id: "REF-A", key: "REF-A", linkType: "blocks", direction: "outward" },
      { id: "REF-B", key: "REF-B", linkType: "blocks", direction: "outward" },
    ];
    const adapter = makeMockAdapter({
      linked: refs,
      issues: {
        "REF-A": { title: "TTT", description: body50 },
        "REF-B": { title: "TTT", description: body50 },
      },
      comments: {
        "REF-A": [
          { author: "u", body: cmt40, created: "" },
          { author: "u", body: cmt40, created: "" },
        ],
        "REF-B": [{ author: "u", body: cmt40, created: "" }],
      },
    });

    // Per-issue: title 3 + body 50 + comments-concat = base 53.
    // Ref A: 53 + 80 = 133 chars -> 34 tokens.
    // Ref B: 53 + 40 =  93 chars -> 24 tokens.
    // Total: 58 tokens. Budget = 55 -> drop exactly one comment.
    const result = await fetchLinkedIssuesContext(adapter, "PROJ-1", 55);

    expect(result.included).toHaveLength(2);
    expect(result.dropped).toHaveLength(0);
    const a = result.included.find((c) => c.ref.id === "REF-A");
    const b = result.included.find((c) => c.ref.id === "REF-B");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a!.comments.length).toBe(1); // dropped from larger-count ref
    expect(b!.comments.length).toBe(1); // unchanged
  });

  it("fail-soft when adapter.getLinkedIssues throws — returns empty result without throwing", async () => {
    const adapter = makeMockAdapter({ throwOn: "getLinkedIssues" });

    const result = await fetchLinkedIssuesContext(adapter, "PROJ-1", 1000);

    expect(result).toEqual({ included: [], dropped: [], tokensUsed: 0 });
  });

  it("tokensUsed equals sum of ceil(per-issue char-count / 4) — accumulator contract", async () => {
    // Hand-counted fixture:
    //   refA: title="AAAA" 4, body="BBBBBBBB" 8, comments=[{body:"CCCC"}] body 4
    //         per-issue chars = 4 + 8 + 4 = 16 -> ceil(16/4) = 4 tokens
    //   refB: title="DD" 2, body="EEEE" 4, comments=[]
    //         per-issue chars = 2 + 4 + 0 = 6 -> ceil(6/4) = 2 tokens
    // Expected tokensUsed = 4 + 2 = 6.
    const refs: LinkedIssueRef[] = [
      { id: "A", key: "A", linkType: "blocks", direction: "outward" },
      { id: "B", key: "B", linkType: "blocks", direction: "outward" },
    ];
    const adapter = makeMockAdapter({
      linked: refs,
      issues: {
        A: { title: "AAAA", description: "BBBBBBBB" },
        B: { title: "DD", description: "EEEE" },
      },
      comments: {
        A: [{ author: "x", body: "CCCC", created: "" }],
        B: [],
      },
    });

    const result = await fetchLinkedIssuesContext(adapter, "PROJ-1", 1000);

    expect(result.included).toHaveLength(2);
    expect(result.dropped).toHaveLength(0);
    expect(result.tokensUsed).toBe(6);
  });

  it("fail-soft when adapter does not implement getLinkedIssues — returns empty result", async () => {
    const adapter = makeMockAdapter({ omitGetLinkedIssues: true });

    const result = await fetchLinkedIssuesContext(adapter, "PROJ-1", 1000);

    expect(result).toEqual({ included: [], dropped: [], tokensUsed: 0 });
  });

  it("tie-break path with many same-count candidates — selects longest comment", async () => {
    // Regression test for WR-04: many linked issues with the same comment
    // count exercise the tie-break path repeatedly. Uses 50 refs so the
    // O(N) inner reduce runs O(N^2) times in the outer drop loop.
    //
    // All refs have one comment of length 40 EXCEPT REF-25 which has one
    // comment of length 80. With a tight budget that forces dropping one
    // comment, the implementation should select REF-25 (longest) — and
    // a buggy Math.max(...) spread would either still pick REF-25 (correct)
    // or RangeError on huge arrays (not tested here).
    const refCount = 50;
    const refs: LinkedIssueRef[] = Array.from({ length: refCount }, (_, i) => ({
      id: `R-${i}`,
      key: `R-${i}`,
      linkType: "blocks" as const,
      direction: "outward" as const,
    }));
    const issues: Record<string, Partial<IssueData>> = {};
    const comments: Record<string, IssueComment[]> = {};
    for (let i = 0; i < refCount; i++) {
      issues[`R-${i}`] = { title: "T", description: "b".repeat(20) };
      comments[`R-${i}`] = [
        {
          author: "u",
          body: i === 25 ? "x".repeat(80) : "x".repeat(40),
          created: "",
        },
      ];
    }
    const adapter = makeMockAdapter({ linked: refs, issues, comments });

    // Per-issue base = title(1) + body(20) = 21 chars; with one comment of
    // 40 chars total = 61 chars -> ceil(61/4) = 16 tokens. R-25 = 21 + 80 =
    // 101 chars -> 26 tokens. Total 49*16 + 26 = 810. Budget 800 forces one
    // comment drop; tie-break should pick R-25 (longest comment).
    const result = await fetchLinkedIssuesContext(adapter, "PROJ-1", 800);

    expect(result.included).toHaveLength(refCount);
    expect(result.dropped).toHaveLength(0);
    const r25 = result.included.find((c) => c.ref.id === "R-25");
    expect(r25).toBeDefined();
    expect(r25!.comments.length).toBe(0); // tie-break dropped from longest
    const droppedFromOthers = result.included.filter(
      (c) => c.ref.id !== "R-25" && c.comments.length === 0
    );
    expect(droppedFromOthers).toHaveLength(0);
  });

  it("per-linked-ref fail-soft when getIssue throws but getIssueComments succeeds", async () => {
    const refs: LinkedIssueRef[] = [
      { id: "PROJ-2", key: "PROJ-2", linkType: "blocks", direction: "outward" },
    ];
    const adapter = makeMockAdapter({
      linked: refs,
      throwOnIssueIds: ["PROJ-2"],
      comments: {
        "PROJ-2": [
          { author: "alice", body: "still here", created: "2026-01-01" },
        ],
      },
    });

    const result = await fetchLinkedIssuesContext(adapter, "PROJ-1", 1000);

    expect(result.included).toHaveLength(1);
    expect(result.included[0].ref.id).toBe("PROJ-2");
    expect(result.included[0].body).toBeUndefined();
    expect(result.included[0].title).toBe("PROJ-2"); // ref.key fallback
    expect(result.included[0].comments).toHaveLength(1);
    expect(result.included[0].comments[0].body).toBe("still here");
    expect(result.dropped).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// INT-06: buildSystemPrompt + parseAndValidateTestCases parameter+dataset
// extension (D-10 / D-11 / D-12 / Pitfall 6)
// ---------------------------------------------------------------------------

const sampleTemplate: TemplateData = {
  id: 1,
  name: "Functional",
  fields: [
    { id: 10, name: "Description", type: "Text Long", required: true },
    {
      id: 11,
      name: "Steps",
      type: "Steps",
      required: true,
    },
    {
      id: 12,
      name: "Priority",
      type: "Dropdown",
      required: false,
      options: ["High", "Medium", "Low"],
    },
  ],
};

const sampleIssue: LlmIssueData = {
  key: "PROJ-1",
  title: "Login with valid credentials",
  description: "Test login flow",
  status: "Open",
};

describe("buildSystemPrompt — INT-06 includeParameters extension", () => {
  it("includeParameters=false produces output equivalent to legacy behavior (no parameter section)", () => {
    const promptOff = buildSystemPrompt(
      sampleTemplate,
      { folderContext: 0 },
      "few",
      true,
      undefined,
      false
    );

    // Regression guard: the new toggle off must not introduce parameter
    // instructions. The arity-extended call site with the new default-false
    // arg should be indistinguishable from the legacy 5-arg call.
    expect(promptOff).not.toContain("parameters");
    expect(promptOff).not.toContain("starterDataset");
    expect(promptOff).not.toContain("allowedValuesJson");

    // And the explicit-false version equals the omitted version (legacy callers).
    const promptLegacy = buildSystemPrompt(
      sampleTemplate,
      { folderContext: 0 },
      "few",
      true,
      undefined
    );
    expect(promptOff).toBe(promptLegacy);
  });

  it("includeParameters=true appends parameter + dataset instructions referencing allowedValuesJson (not allowedValues)", () => {
    const prompt = buildSystemPrompt(
      sampleTemplate,
      { folderContext: 0 },
      "few",
      false,
      undefined,
      true
    );

    expect(prompt).toContain("parameters");
    expect(prompt).toContain("starterDataset");
    expect(prompt).toContain("allowedValuesJson");
    // D-12: SELECT-XOR — prompt must say SELECT requires allowedValuesJson.
    expect(prompt).toMatch(/SELECT[\s\S]*allowedValuesJson/);
    // Pitfall 6: parameters emitted BEFORE starterDataset (truncation grace).
    expect(prompt.indexOf("parameters")).toBeLessThan(
      prompt.indexOf("starterDataset")
    );
    // The prompt MUST NOT use the bare name `allowedValues` as a JSON key
    // (Phase 1 schema uses `allowedValuesJson` and the parser keys on that
    // exact name). The instruction text intentionally warns "NOT
    // 'allowedValues'" — that's the only place the bare name appears.
    expect(prompt).not.toMatch(/"allowedValues"\s*:/);
    // Sanity: every occurrence of `allowedValues` should be followed by
    // `Json` (the canonical field name) or be inside the quoted prohibition
    // phrase "NOT 'allowedValues'" / "NOT \"allowedValues\"".
    const bareMatches = Array.from(prompt.matchAll(/allowedValues(?!Json)/g));
    for (const m of bareMatches) {
      const surrounding = prompt.substring(
        Math.max(0, (m.index ?? 0) - 15),
        Math.min(prompt.length, (m.index ?? 0) + 30)
      );
      expect(surrounding).toMatch(/NOT.*allowedValues/);
    }
  });

  it("LLM-side validator imports parameterCreateSchema for structural reference (compile-time + runtime smoke)", () => {
    // Compile-time: the import line above must resolve. Runtime: the schema is
    // shaped as expected for the LLM-side superset (SELECT XOR, sensitive
    // boolean, allowedValuesJson string[]).
    expect(parameterCreateSchema).toBeDefined();
    expect(typeof parameterCreateSchema.parse).toBe("function");
    // Sanity-check the SELECT XOR still rejects an inline+lookup combination
    // (proves the schema we superset against is the one we think it is).
    expect(() =>
      parameterCreateSchema.parse({
        testCaseId: 1,
        name: "env",
        type: "SELECT",
        allowedValuesJson: ["dev", "prod"],
        lookupDataSetId: 2,
      })
    ).toThrow();
  });
});

describe("existing-case context — issue-linked cases", () => {
  /**
   * Minimal stand-in for the raw client: `repositoryCases.findMany` records the
   * where-clause it was called with and returns the rows the test queued for
   * that call, `repositoryFolders.findMany` backs the hierarchy walk.
   */
  function makeContextDb(opts: {
    caseRowsPerCall?: any[][];
    folders?: { id: number; parentId: number | null }[];
  }) {
    const calls: any[] = [];
    const queue = [...(opts.caseRowsPerCall ?? [])];
    return {
      calls,
      db: {
        repositoryCases: {
          findMany: vi.fn(async (args: any) => {
            calls.push(args);
            return queue.shift() ?? [];
          }),
        },
        repositoryFolders: {
          findMany: vi.fn(async () => opts.folders ?? []),
        },
      },
    };
  }

  const caseRow = (id: number, name: string) => ({
    id,
    name,
    template: { templateName: "Functional" },
    caseFieldValues: [],
    steps: [],
  });

  it("matches on the internal Issue.id when the caller knows it", async () => {
    const { db, calls } = makeContextDb({
      caseRowsPerCall: [[caseRow(1, "Existing linked case")]],
    });

    const result = await fetchIssueLinkedCasesContext(
      db,
      7,
      { issueId: 42, issueKey: "PROJ-1" },
      1000
    );

    expect(result.cases.map((c) => c.name)).toEqual(["Existing linked case"]);
    expect(result.caseIds).toEqual(new Set([1]));
    expect(calls[0].where).toMatchObject({
      projectId: 7,
      isDeleted: false,
      isArchived: false,
      caseIssues: { some: { issue: { id: 42 } } },
    });
  });

  it("falls back to tracker identity, scoped by integration when known", async () => {
    const { db, calls } = makeContextDb({
      caseRowsPerCall: [[caseRow(1, "Linked by key")]],
    });

    await fetchIssueLinkedCasesContext(
      db,
      7,
      { issueKey: "PROJ-1", externalId: "10042", integrationId: 3 },
      1000
    );

    const issueWhere = calls[0].where.caseIssues.some.issue;
    expect(issueWhere.integrationId).toBe(3);
    // A synced issue carries the key in externalKey, a manual one in name.
    expect(issueWhere.OR).toEqual([
      { externalId: "10042" },
      { externalKey: "PROJ-1" },
      { name: "PROJ-1" },
    ]);
  });

  it("queries nothing when the ref carries no usable identity", async () => {
    const { db } = makeContextDb({});

    const result = await fetchIssueLinkedCasesContext(db, 7, {}, 1000);

    expect(result.cases).toEqual([]);
    expect(db.repositoryCases.findMany).not.toHaveBeenCalled();
  });

  it("still returns context when there is no folder (Jira panel / milestone)", async () => {
    // folderId 0 is what both no-folder flows pass — the hierarchy walk finds
    // nothing, so issue-linked cases are the only context available.
    const { db } = makeContextDb({
      caseRowsPerCall: [[caseRow(1, "Only linked case")], []],
      folders: [],
    });

    const cases = await fetchExistingCasesContext(
      db,
      7,
      { folderId: 0, issueRef: { issueId: 42 } },
      1000,
      "names"
    );

    expect(cases.map((c) => c.name)).toEqual(["Only linked case"]);
  });

  it("puts issue-linked cases first and never lists a case twice", async () => {
    const { db } = makeContextDb({
      // Call 1: issue-linked. Call 2: the folder, which also contains case 1.
      caseRowsPerCall: [
        [caseRow(1, "Linked and in folder")],
        [
          { ...caseRow(1, "Linked and in folder"), folderId: 5 },
          { ...caseRow(2, "Folder sibling"), folderId: 5 },
        ],
      ],
      folders: [{ id: 5, parentId: null }],
    });

    const cases = await fetchExistingCasesContext(
      db,
      7,
      { folderId: 5, issueRef: { issueId: 42 } },
      1000,
      "names"
    );

    expect(cases.map((c) => c.name)).toEqual([
      "Linked and in folder",
      "Folder sibling",
    ]);
  });

  it("bills the shared budget — linked cases claim it first", async () => {
    const { db, calls } = makeContextDb({
      caseRowsPerCall: [
        [caseRow(1, "A".repeat(200))],
        [{ ...caseRow(2, "Folder case"), folderId: 5 }],
      ],
      folders: [{ id: 5, parentId: null }],
    });

    const linkedOnly = await fetchIssueLinkedCasesContext(
      db,
      7,
      { issueId: 42 },
      1000,
      "names"
    );
    expect(linkedOnly.tokensUsed).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);

    // A budget too small for even the first linked case yields nothing, and the
    // hierarchy pass is still reached with what's left.
    const { db: tightDb } = makeContextDb({
      caseRowsPerCall: [[caseRow(1, "A".repeat(400))], []],
      folders: [{ id: 5, parentId: null }],
    });
    const tight = await fetchExistingCasesContext(
      tightDb,
      7,
      { folderId: 5, issueRef: { issueId: 42 } },
      5,
      "names"
    );
    expect(tight).toEqual([]);
  });
});

describe("deselected fields — prompt exclusion + response strip", () => {
  const templateWithExclusions: TemplateData = {
    ...sampleTemplate,
    excludedFields: ["Preconditions", "Post Conditions"],
  };

  it("names every excluded field as a forbidden key in the fallback prompt", () => {
    const prompt = buildSystemPrompt(
      templateWithExclusions,
      { folderContext: 0 },
      "few",
      false,
      undefined,
      false
    );

    expect(prompt).toContain("EXCLUDED FIELDS");
    expect(prompt).toContain("- Preconditions");
    expect(prompt).toContain("- Post Conditions");
    // The exclusion list must land after the field lists it refers back to.
    expect(prompt.indexOf("EXCLUDED FIELDS")).toBeGreaterThan(
      prompt.indexOf("ADDITIONAL FIELDS")
    );
  });

  it("omits the exclusion section entirely when nothing was deselected", () => {
    const prompt = buildSystemPrompt(
      sampleTemplate,
      { folderContext: 0 },
      "few",
      false,
      undefined,
      false
    );

    expect(prompt).not.toContain("EXCLUDED FIELDS");
  });

  it("never lists a field as both included and excluded", () => {
    const prompt = buildSystemPrompt(
      { ...sampleTemplate, excludedFields: ["Priority", "Preconditions"] },
      { folderContext: 0 },
      "few",
      false,
      undefined,
      false
    );

    // "Priority" is a real template field — a caller that also lists it as
    // excluded must not produce contradictory instructions.
    expect(prompt).toContain("- Preconditions");
    expect(prompt).not.toMatch(/EXCLUDED FIELDS[\s\S]*^- Priority$/m);
  });

  it("appends the exclusion block to custom prompts that lack the variable", () => {
    const customTemplate =
      "{{EXAMPLE_STRUCTURE}}\n\nREQUIRED:\n{{REQUIRED_FIELDS_LIST}}\n\nADDITIONAL FIELDS:\n{{OPTIONAL_FIELDS_LIST}}\n\nReturn ONLY the JSON.";

    const prompt = buildSystemPrompt(
      templateWithExclusions,
      { folderContext: 0 },
      "few",
      false,
      customTemplate,
      false
    );

    expect(prompt).toContain("EXCLUDED FIELDS");
    expect(prompt).toContain("- Preconditions");
  });

  it("lets a custom prompt own the wording via {{EXCLUDED_FIELDS_LIST}}", () => {
    const customTemplate =
      "{{EXAMPLE_STRUCTURE}}\n\nSKIP THESE:\n{{EXCLUDED_FIELDS_LIST}}\n\nReturn ONLY the JSON.";

    const prompt = buildSystemPrompt(
      templateWithExclusions,
      { folderContext: 0 },
      "few",
      false,
      customTemplate,
      false
    );

    expect(prompt).toContain("SKIP THESE:\n- Preconditions\n- Post Conditions");
    // No appended block — the custom prompt already rendered the list.
    expect(prompt).not.toContain("EXCLUDED FIELDS (");
  });

  it("renders the variable as (none) when nothing was deselected", () => {
    const prompt = buildSystemPrompt(
      sampleTemplate,
      { folderContext: 0 },
      "few",
      false,
      "{{EXAMPLE_STRUCTURE}}\n\nSKIP THESE:\n{{EXCLUDED_FIELDS_LIST}}",
      false
    );

    expect(prompt).toContain("SKIP THESE:\n- (none)");
  });

  it("drops fieldValues keys outside the template, whatever the model emits", () => {
    const { testCases } = parseAndValidateTestCases(
      JSON.stringify({
        testCases: [
          {
            id: "tc_1",
            name: "Login succeeds",
            fieldValues: {
              Description: "Validates login",
              Steps: [{ step: "Open login", expectedResult: "Form shows" }],
              Priority: "High",
              // Deselected by the user — the model volunteered them anyway.
              Preconditions: "User exists",
              "Post Conditions": "Session created",
            },
          },
        ],
      }),
      templateWithExclusions,
      sampleIssue
    );

    expect(Object.keys(testCases[0].fieldValues).sort()).toEqual([
      "Description",
      "Priority",
      "Steps",
    ]);
  });

  it("keeps the top-level steps/priority migration working after the strip", () => {
    const { testCases } = parseAndValidateTestCases(
      JSON.stringify({
        testCases: [
          {
            id: "tc_1",
            name: "Login succeeds",
            fieldValues: { Description: "Validates login", Notes: "ignore me" },
            steps: [{ step: "Open login", expectedResult: "Form shows" }],
            priority: "High",
          },
        ],
      }),
      sampleTemplate,
      sampleIssue
    );

    expect(testCases[0].fieldValues.Steps).toHaveLength(1);
    expect(testCases[0].fieldValues.Priority).toBe("High");
    expect(testCases[0].fieldValues).not.toHaveProperty("Notes");
  });
});

describe("Steps field — shape normalization", () => {
  function parseSteps(fieldValues: Record<string, any>, extra = {}) {
    const { testCases } = parseAndValidateTestCases(
      JSON.stringify({
        testCases: [{ id: "tc_1", name: "Case", fieldValues, ...extra }],
      }),
      sampleTemplate,
      sampleIssue
    );
    return testCases[0].fieldValues.Steps;
  }

  it("keeps every step of a well-formed array", () => {
    const steps = parseSteps({
      Steps: [
        { step: "one", expectedResult: "r1" },
        { step: "two", expectedResult: "r2" },
        { step: "three", expectedResult: "r3" },
      ],
    });

    expect(steps).toHaveLength(3);
    expect(steps.map((s: any) => s.step)).toEqual(["one", "two", "three"]);
  });

  it("expands a numbered list emitted as a single string", () => {
    const steps = parseSteps({ Steps: "1. Open page\n2. Click save" });

    expect(steps).toHaveLength(2);
    expect(steps[0].step).toBe("Open page");
    expect(steps[1].step).toBe("Click save");
  });

  it("wraps a lone step object in an array", () => {
    const steps = parseSteps({ Steps: { step: "only", expectedResult: "ok" } });
    expect(steps).toEqual([{ step: "only", expectedResult: "ok" }]);
  });

  it("accepts action / expected key spellings", () => {
    const steps = parseSteps({
      Steps: [{ action: "click", expected: "modal opens" }],
    });

    expect(steps[0]).toMatchObject({
      step: "click",
      expectedResult: "modal opens",
    });
  });

  it("normalizes steps migrated from the top level too", () => {
    const { testCases } = parseAndValidateTestCases(
      JSON.stringify({
        testCases: [
          {
            id: "tc_1",
            name: "Case",
            fieldValues: { Description: "d" },
            steps: [{ action: "a", expected: "b" }],
          },
        ],
      }),
      sampleTemplate,
      sampleIssue
    );

    expect(testCases[0].fieldValues.Steps).toEqual([
      expect.objectContaining({ step: "a", expectedResult: "b" }),
    ]);
  });

  it("tells the model to emit one object per action", () => {
    const prompt = buildSystemPrompt(
      sampleTemplate,
      { folderContext: 0 },
      "few",
      false,
      undefined,
      false
    );

    expect(prompt).toContain("ARRAY of detailed step objects");
    expect(prompt).toContain("one object per individual action");
  });
});

describe("buildSystemPrompt — name field language consistency", () => {
  it("fallback (inline) prompt instructs that the name match the fieldValues language", () => {
    const prompt = buildSystemPrompt(
      sampleTemplate,
      { folderContext: 0 },
      "few",
      false,
      undefined,
      false
    );

    expect(prompt).toContain("LANGUAGE CONSISTENCY");
    expect(prompt).toMatch(/name[\s\S]*same language[\s\S]*fieldValues/i);
  });

  it("custom/DB template (baseTemplate) path injects the language instruction when missing", () => {
    const customTemplate =
      "Responde SIEMPRE en español.\n\n{{EXAMPLE_STRUCTURE}}\n\nREQUIRED:\n{{REQUIRED_FIELDS_LIST}}\n\nReturn ONLY the JSON.";

    const prompt = buildSystemPrompt(
      sampleTemplate,
      { folderContext: 0 },
      "few",
      false,
      customTemplate,
      false
    );

    // The admin's custom instruction is preserved...
    expect(prompt).toContain("Responde SIEMPRE en español.");
    // ...and the name-language guardrail reaches custom prompts too.
    expect(prompt).toContain("LANGUAGE CONSISTENCY");
    expect(prompt).toMatch(/name[\s\S]*same language[\s\S]*fieldValues/i);
  });

  it("does not duplicate the instruction when the base template already carries it", () => {
    const seededTemplate =
      "{{EXAMPLE_STRUCTURE}}\n\nREQUIREMENTS:\n- LANGUAGE CONSISTENCY: Write the name in the same language as fieldValues.\n\nReturn ONLY the JSON.";

    const prompt = buildSystemPrompt(
      sampleTemplate,
      { folderContext: 0 },
      "few",
      false,
      seededTemplate,
      false
    );

    const occurrences = prompt.split("LANGUAGE CONSISTENCY").length - 1;
    expect(occurrences).toBe(1);
  });
});

describe("buildOutlineSystemPrompt — title language follows project prompt", () => {
  it("without style guidance, leaves the outline prompt language-neutral", () => {
    const prompt = buildOutlineSystemPrompt("few");
    expect(prompt).toContain('"outlines"');
    expect(prompt).not.toContain("PROJECT GENERATION INSTRUCTIONS");
  });

  it("forwards the resolved prompt so titles follow its language directive", () => {
    const prompt = buildOutlineSystemPrompt(
      "few",
      "You are a generator. Responde SIEMPRE en español."
    );

    // The project's prompt (carrying the language directive) is forwarded...
    expect(prompt).toContain("Responde SIEMPRE en español.");
    expect(prompt).toContain("PROJECT GENERATION INSTRUCTIONS");
    // ...and the outline still owns the authoritative output format.
    expect(prompt).toContain('"outlines"');
    expect(prompt).toMatch(/language[\s\S]*project instructions/i);
  });
});

describe("parseAndValidateTestCases — INT-06 parameter+dataset extraction", () => {
  function buildResponse(testCases: unknown[]): string {
    return JSON.stringify({ testCases });
  }

  it("extracts parameters[] and starterDataset[] when present (happy path with SELECT param using allowedValuesJson)", () => {
    const raw = buildResponse([
      {
        id: "tc_1",
        name: "Login as different roles",
        fieldValues: {
          Description: "Validate login for each role",
          Steps: [{ step: "Login", expectedResult: "Success" }],
          Priority: "High",
        },
        parameters: [
          {
            name: "role",
            type: "SELECT",
            sensitive: false,
            allowedValuesJson: ["admin", "user", "guest"],
          },
          { name: "remember_me", type: "BOOLEAN", sensitive: false },
        ],
        starterDataset: [
          { label: "admin row", values: { role: "admin", remember_me: true } },
          { label: "user row", values: { role: "user", remember_me: false } },
        ],
      },
    ]);

    const { testCases, warnings } = parseAndValidateTestCases(
      raw,
      sampleTemplate,
      sampleIssue,
      false,
      "few"
    );

    expect(testCases).toHaveLength(1);
    expect(testCases[0].parameters).toHaveLength(2);
    expect(testCases[0].parameters?.[0]).toMatchObject({
      name: "role",
      type: "SELECT",
      sensitive: false,
      allowedValuesJson: ["admin", "user", "guest"],
    });
    expect(testCases[0].parameters?.[1]).toMatchObject({
      name: "remember_me",
      type: "BOOLEAN",
      sensitive: false,
    });
    expect(testCases[0].starterDataset).toHaveLength(2);
    expect(testCases[0].starterDataset?.[0]).toMatchObject({
      label: "admin row",
      values: { role: "admin", remember_me: true },
    });
    expect(warnings ?? []).toEqual([]);
  });

  it("rejects SELECT parameter without allowedValuesJson — per-param warning, not whole-case rejection (D-12)", () => {
    const raw = buildResponse([
      {
        id: "tc_1",
        name: "Test case",
        fieldValues: {
          Description: "x",
          Steps: [{ step: "s", expectedResult: "r" }],
        },
        parameters: [
          { name: "env", type: "SELECT", sensitive: false }, // missing allowedValuesJson
          { name: "username", type: "STRING", sensitive: false },
        ],
        starterDataset: [{ values: { username: "alice" } }],
      },
    ]);

    const { testCases, warnings } = parseAndValidateTestCases(
      raw,
      sampleTemplate,
      sampleIssue,
      false,
      "few"
    );

    expect(testCases).toHaveLength(1);
    // The invalid SELECT param is dropped, the valid STRING param survives.
    expect(testCases[0].parameters?.map((p) => p.name)).toEqual(["username"]);
    expect(warnings).toBeDefined();
    expect(warnings!.some((w) => w.message.includes("invalid_parameter"))).toBe(
      true
    );
  });

  it("rejects non-SELECT parameter that includes allowedValuesJson (XOR the other direction)", () => {
    const raw = buildResponse([
      {
        id: "tc_1",
        name: "Test case",
        fieldValues: {
          Description: "x",
          Steps: [{ step: "s", expectedResult: "r" }],
        },
        parameters: [
          {
            name: "count",
            type: "INTEGER",
            sensitive: false,
            allowedValuesJson: ["1", "2"], // forbidden on non-SELECT
          },
          { name: "username", type: "STRING", sensitive: false },
        ],
        starterDataset: [{ values: { username: "alice", count: 1 } }],
      },
    ]);

    const { testCases, warnings } = parseAndValidateTestCases(
      raw,
      sampleTemplate,
      sampleIssue,
      false,
      "few"
    );

    expect(testCases).toHaveLength(1);
    expect(testCases[0].parameters?.map((p) => p.name)).toEqual(["username"]);
    expect(warnings!.some((w) => w.message.includes("invalid_parameter"))).toBe(
      true
    );
  });

  it("truncated starterDataset surfaces dataset_truncated warning but keeps parameters (Pitfall 6)", () => {
    // Hand-craft a raw response whose `starterDataset` array is structurally
    // broken (not an array) — parser should keep the parameters and surface a
    // dataset_truncated warning rather than dropping the whole case.
    const raw = JSON.stringify({
      testCases: [
        {
          id: "tc_1",
          name: "TC",
          fieldValues: {
            Description: "x",
            Steps: [{ step: "s", expectedResult: "r" }],
          },
          parameters: [{ name: "env", type: "STRING", sensitive: false }],
          starterDataset: "TRUNCATED", // not an array — recovered as empty
        },
      ],
    });

    const { testCases, warnings } = parseAndValidateTestCases(
      raw,
      sampleTemplate,
      sampleIssue,
      false,
      "few"
    );

    expect(testCases).toHaveLength(1);
    expect(testCases[0].parameters).toHaveLength(1);
    expect(testCases[0].starterDataset).toEqual([]);
    expect(warnings!.some((w) => w.message === "dataset_truncated")).toBe(true);
  });

  it("starterDataset rows beyond cap (50) are truncated with a warning, not rejected (DoS guard)", () => {
    const tooMany = Array.from({ length: 75 }, (_, i) => ({
      values: { env: `env-${i}` },
    }));
    const raw = buildResponse([
      {
        id: "tc_1",
        name: "TC",
        fieldValues: {
          Description: "x",
          Steps: [{ step: "s", expectedResult: "r" }],
        },
        parameters: [{ name: "env", type: "STRING", sensitive: false }],
        starterDataset: tooMany,
      },
    ]);

    const { testCases, warnings } = parseAndValidateTestCases(
      raw,
      sampleTemplate,
      sampleIssue,
      false,
      "few"
    );

    expect(testCases).toHaveLength(1);
    expect(testCases[0].starterDataset).toHaveLength(50);
    expect(warnings!.some((w) => w.message === "dataset_capped")).toBe(true);
  });

  it("parameter with reserved name (__proto__) is rejected (prototype-pollution guard)", () => {
    const raw = buildResponse([
      {
        id: "tc_1",
        name: "TC",
        fieldValues: {
          Description: "x",
          Steps: [{ step: "s", expectedResult: "r" }],
        },
        parameters: [
          { name: "__proto__", type: "STRING", sensitive: false },
          { name: "username", type: "STRING", sensitive: false },
        ],
        starterDataset: [{ values: { username: "alice" } }],
      },
    ]);

    const { testCases, warnings } = parseAndValidateTestCases(
      raw,
      sampleTemplate,
      sampleIssue,
      false,
      "few"
    );

    expect(testCases).toHaveLength(1);
    expect(testCases[0].parameters?.map((p) => p.name)).toEqual(["username"]);
    expect(warnings!.some((w) => w.message.includes("invalid_parameter"))).toBe(
      true
    );
  });

  it("absent parameters/starterDataset keys preserve legacy behavior (no warnings, no new fields)", () => {
    const raw = buildResponse([
      {
        id: "tc_1",
        name: "TC",
        fieldValues: {
          Description: "x",
          Steps: [{ step: "s", expectedResult: "r" }],
          Priority: "High",
        },
      },
    ]);

    const { testCases, warnings } = parseAndValidateTestCases(
      raw,
      sampleTemplate,
      sampleIssue,
      false,
      "few"
    );

    expect(testCases).toHaveLength(1);
    expect(testCases[0].parameters).toBeUndefined();
    expect(testCases[0].starterDataset).toBeUndefined();
    expect(warnings ?? []).toEqual([]);
  });
});

describe("buildOutlineUserPrompt — existing cases context", () => {
  it("omits the existing-cases block when no cases are supplied", () => {
    const prompt = buildOutlineUserPrompt(sampleIssue, {
      folderContext: 0,
      userNotes: "edge cases",
    });
    expect(prompt).not.toContain("DO NOT DUPLICATE");
    expect(prompt).not.toContain("EXISTING TEST CASES");
    expect(prompt).toContain("ADDITIONAL TESTING GUIDANCE: edge cases");
  });

  it("renders each existing case as a numbered title-only item", () => {
    const prompt = buildOutlineUserPrompt(sampleIssue, {
      folderContext: 0,
      existingTestCases: [
        {
          name: "Login with valid credentials",
          template: "Default",
          description: "Happy path",
        },
        {
          name: "Login with locked account",
          template: "Default",
          description: "Account is locked after 5 failures",
        },
      ],
    });
    expect(prompt).toContain(
      "EXISTING TEST CASE TITLES — DO NOT DUPLICATE OR SUBSTANTIALLY OVERLAP"
    );
    expect(prompt).toContain("1. Login with valid credentials");
    expect(prompt).toContain("2. Login with locked account");
    expect(prompt).toContain("must cover scenarios NOT already represented");
  });

  it("does not render case descriptions in the outline prompt", () => {
    // Outlines deliberately stay title-only — the LLM doesn't need full
    // case detail to avoid title collisions, and keeping the prompt small
    // matters for latency under the integration's request timeout.
    const prompt = buildOutlineUserPrompt(sampleIssue, {
      folderContext: 0,
      existingTestCases: [
        {
          name: "Case A",
          template: "Default",
          description: "Some description that should never appear",
          steps: [
            { step: "Open page", expectedResult: "Page loads" },
            { step: "Click button", expectedResult: "Modal opens" },
          ],
        },
      ],
    });
    expect(prompt).toContain("1. Case A");
    expect(prompt).not.toContain("Some description");
    expect(prompt).not.toContain("Open page");
    expect(prompt).not.toContain("Modal opens");
  });
});

// Enrichment restored after the two-phase refactor (#304) dropped it: the
// outline and expand prompts must fold in the source issue's comments and its
// one-hop linked issues (title/body/comments).
describe("issue enrichment sections — comments + linked issues", () => {
  const enrichedIssue: LlmIssueData = {
    key: "PROJ-9",
    title: "Password reset",
    description: "User can reset their password",
    status: "Open",
    priority: "High",
    comments: [
      {
        author: "alice",
        body: "Reset link must expire after 15 minutes",
        created: "2026-01-01T00:00:00Z",
      },
      {
        author: "bob",
        body: "Rate-limit reset requests",
        created: "2026-01-02T00:00:00Z",
      },
    ],
  };

  const linkedIssues: LinkedIssueContext[] = [
    {
      ref: {
        id: "100",
        key: "PROJ-2",
        linkType: "blocks",
        direction: "outward",
      },
      title: "Email delivery service",
      body: "Sends the reset emails",
      comments: [
        {
          author: "carol",
          body: "Handle SMTP timeouts",
          created: "2026-01-03T00:00:00Z",
        },
      ],
    },
  ];

  const enrichedContext: GenerationContext = {
    folderContext: 0,
    linkedIssues,
  };

  describe("buildCommentsSection", () => {
    it("returns '' for undefined or empty comments", () => {
      expect(buildCommentsSection(undefined)).toBe("");
      expect(buildCommentsSection([])).toBe("");
    });

    it("renders each comment as a numbered author: body line", () => {
      const section = buildCommentsSection(enrichedIssue.comments);
      expect(section).toContain("RELEVANT COMMENTS:");
      expect(section).toContain(
        "1. alice: Reset link must expire after 15 minutes"
      );
      expect(section).toContain("2. bob: Rate-limit reset requests");
    });
  });

  describe("buildLinkedIssuesSection", () => {
    it("returns '' for undefined or empty linked issues", () => {
      expect(buildLinkedIssuesSection(undefined)).toBe("");
      expect(buildLinkedIssuesSection([])).toBe("");
    });

    it("renders key, link type/direction, title, body, and comments", () => {
      const section = buildLinkedIssuesSection(linkedIssues);
      expect(section).toContain("RELATED LINKED ISSUES:");
      expect(section).toContain(
        "1. PROJ-2 (blocks, outward): Email delivery service"
      );
      expect(section).toContain("Body: Sends the reset emails");
      expect(section).toContain("Comment 1 (carol): Handle SMTP timeouts");
    });

    it("falls back to the ref id when no key is present", () => {
      const section = buildLinkedIssuesSection([
        {
          ref: { id: "555", linkType: "relates to", direction: "inward" },
          title: "Untitled dep",
          comments: [],
        },
      ]);
      expect(section).toContain("1. 555 (relates to, inward): Untitled dep");
    });
  });

  describe("buildOutlineUserPrompt — enrichment", () => {
    it("folds comments and linked issues into the outline prompt", () => {
      const prompt = buildOutlineUserPrompt(enrichedIssue, enrichedContext);
      expect(prompt).toContain("RELEVANT COMMENTS:");
      expect(prompt).toContain(
        "1. alice: Reset link must expire after 15 minutes"
      );
      expect(prompt).toContain("RELATED LINKED ISSUES:");
      expect(prompt).toContain(
        "1. PROJ-2 (blocks, outward): Email delivery service"
      );
      expect(prompt).toContain("Comment 1 (carol): Handle SMTP timeouts");
    });

    it("omits both sections for an un-enriched (e.g. manual) issue", () => {
      const prompt = buildOutlineUserPrompt(sampleIssue, { folderContext: 0 });
      expect(prompt).not.toContain("RELEVANT COMMENTS:");
      expect(prompt).not.toContain("RELATED LINKED ISSUES:");
    });
  });

  describe("buildExpandUserPrompt — enrichment", () => {
    const outline = {
      title: "Reset link expires",
      summary: "Link expires in 15m",
    };

    it("inline prompt grounds the case in comments + linked issues", () => {
      const prompt = buildExpandUserPrompt(
        enrichedIssue,
        outline,
        enrichedContext
      );
      expect(prompt).toContain("RELEVANT COMMENTS:");
      expect(prompt).toContain("RELATED LINKED ISSUES:");
      expect(prompt).toContain('Title: "Reset link expires"');
    });

    it("base-template prompt fills the comments + linked-issue placeholders", () => {
      const baseTemplate =
        "ISSUE {{ISSUE_KEY}} {{ISSUE_TITLE}}{{COMMENTS_SECTION}}{{LINKED_ISSUES_SECTION}}{{USER_NOTES_SECTION}}{{EXISTING_CASES_SECTION}}";
      const prompt = buildExpandUserPrompt(
        enrichedIssue,
        outline,
        enrichedContext,
        baseTemplate
      );
      expect(prompt).toContain("RELEVANT COMMENTS:");
      expect(prompt).toContain(
        "1. PROJ-2 (blocks, outward): Email delivery service"
      );
      expect(prompt).toContain('Title: "Reset link expires"');
    });

    it("omits both sections for an un-enriched issue", () => {
      const prompt = buildExpandUserPrompt(sampleIssue, outline, {
        folderContext: 0,
      });
      expect(prompt).not.toContain("RELEVANT COMMENTS:");
      expect(prompt).not.toContain("RELATED LINKED ISSUES:");
    });
  });
});
