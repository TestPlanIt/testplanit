import { describe, expect, it } from "vitest";
import { buildSignatureIssueDraft, ISSUE_DRAFT_MAX_CASES } from "./issueDraft";

const labels = {
  signature: "Signature",
  latestRun: "Latest run",
  classification: "Classification",
  rationale: "Rationale",
  nextStep: "Next step",
  occurrences: "Occurrences / cases / runs",
  affectedCases: "Affected test cases",
  latestFailure: "Latest failure",
};

const base = {
  title: "AssertionError: expected <n> to equal <n>",
  signatureUrl: "https://tpi.test/projects/triage/1/5",
  classificationLabel: "Product bug",
  aiRationale: "500 from the server",
  aiSuggestedIssueTitle: "Bulk import returns 500",
  aiSuggestedNextStep: "Check server logs",
  occurrenceCount: 3,
  caseCount: 2,
  runCount: 1,
  cases: [
    {
      name: "Bulk import users",
      url: "https://tpi.test/projects/repository/1/10",
    },
    { name: "Export CSV", url: "https://tpi.test/projects/repository/1/11" },
  ],
  latestRun: { name: "Build 12", url: "https://tpi.test/projects/runs/1/99" },
  failureText:
    "AssertionError: expected 500 to equal 200\n    at Context.<anonymous> (x.ts:1:1)",
};

describe("buildSignatureIssueDraft", () => {
  it("prefers the AI title and lays out the AI findings, counts, cases and trace", () => {
    const draft = buildSignatureIssueDraft(base, labels);
    expect(draft.title).toBe("Bulk import returns 500");
    const types = draft.description.content.map((n) => n.type);
    expect(types).toEqual([
      "paragraph", // signature link
      "paragraph", // classification
      "paragraph", // rationale
      "paragraph", // next step
      "paragraph", // counts
      "paragraph", // affected cases heading
      "bulletList",
      "paragraph", // latest run link
      "paragraph", // latest failure heading
      "codeBlock",
    ]);
    const first = draft.description.content[0] as {
      content: { text: string; marks?: unknown[] }[];
    };
    expect(first.content[1].text).toBe(base.title);
    expect(first.content[1].marks?.[0]).toMatchObject({
      type: "link",
      attrs: { href: base.signatureUrl },
    });
    expect(JSON.stringify(draft.description)).not.toContain("%");
    expect(JSON.stringify(draft.description)).toContain(
      "https://tpi.test/projects/repository/1/10"
    );
    expect(JSON.stringify(draft.description)).toContain(
      "https://tpi.test/projects/runs/1/99"
    );
  });

  it("falls back to the signature title and skips empty sections", () => {
    const draft = buildSignatureIssueDraft(
      {
        ...base,
        aiSuggestedIssueTitle: null,
        classificationLabel: null,
        aiRationale: null,
        aiSuggestedNextStep: null,
        cases: [],
        latestRun: null,
        failureText: null,
      },
      labels
    );
    expect(draft.title).toBe(base.title);
    expect(draft.description.content.map((n) => n.type)).toEqual([
      "paragraph",
      "paragraph",
    ]);
  });

  it("caps the case list and truncates long traces", () => {
    const cases = Array.from({ length: ISSUE_DRAFT_MAX_CASES + 3 }, (_, i) => ({
      name: `Case ${i}`,
      url: `https://tpi.test/projects/repository/1/${i}`,
    }));
    const draft = buildSignatureIssueDraft(
      { ...base, cases, failureText: "x".repeat(5000) },
      labels
    );
    const list = draft.description.content.find(
      (n) => n.type === "bulletList"
    ) as { content: unknown[] };
    expect(list.content).toHaveLength(ISSUE_DRAFT_MAX_CASES + 1);
    const code = draft.description.content.find(
      (n) => n.type === "codeBlock"
    ) as { content: { text: string }[] };
    expect(code.content[0].text.length).toBeLessThan(5000);
    expect(code.content[0].text.endsWith("…")).toBe(true);
  });
});
