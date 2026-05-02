import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  IssueAdapter,
  IssueComment,
  IssueData,
  LinkedIssueRef,
} from "~/lib/integrations/adapters/IssueAdapter";
import { fetchLinkedIssuesContext } from "./shared";

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
