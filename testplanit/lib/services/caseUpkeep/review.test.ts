import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpkeepCase } from "./caseText";

const mocks = vi.hoisted(() => ({
  resolvePrompt: vi.fn(),
  resolveIntegration: vi.fn(),
  chat: vi.fn(),
  createForWorker: vi.fn(),
  withFieldGuidance: vi.fn(),
}));

vi.mock("~/lib/llm/services/llm-manager.service", () => ({
  LlmManager: {
    createForWorker: (...args: unknown[]) => {
      mocks.createForWorker(...args);
      return {
        resolveIntegration: mocks.resolveIntegration,
        chat: mocks.chat,
      };
    },
  },
}));
vi.mock("~/lib/llm/services/prompt-resolver.service", () => ({
  PromptResolver: class {
    resolve = mocks.resolvePrompt;
  },
}));
vi.mock("~/app/api/llm/generate-test-cases/fieldGuidance", () => ({
  withFieldGuidance: mocks.withFieldGuidance,
}));
vi.mock("~/app/api/llm/generate-test-cases/shared", () => ({
  describeField: (field: { name: string; type: string; guidance?: string }) =>
    `- ${field.name} (${field.type})${field.guidance ? ` guidance: ${field.guidance}` : ""}`,
}));

import {
  CASES_PER_REQUEST,
  MAX_ISSUE_TEXT,
  casesSection,
  fieldsSection,
  reviewCasesAgainstIssue,
} from "./review";

const template = {
  id: 4,
  name: "Functional",
  fields: [
    { id: 1, name: "Priority", type: "Dropdown", required: true },
    { id: 2, name: "Steps", type: "Steps", required: false },
  ],
};

const makeCase = (id: number, extra: Partial<UpkeepCase> = {}): UpkeepCase => ({
  id,
  name: `Case ${id}`,
  fieldValues: {},
  steps: [{ step: "Do it", expectedResult: "Done" }],
  stepsFixed: false,
  ...extra,
});

const params = (cases: UpkeepCase[], extra: Record<string, unknown> = {}) => ({
  projectId: 7,
  tenantId: "t1",
  userId: "system",
  issue: { key: "DEMO-42", title: "Checkout totals", description: "Add tax" },
  otherIssues: [],
  cases,
  template,
  ...extra,
});

const answer = (body: unknown) => ({
  content: JSON.stringify(body),
  finishReason: "stop",
});
const unchanged = (cases: UpkeepCase[]) =>
  answer({ cases: cases.map((c) => ({ id: c.id, action: "unchanged" })) });

const db = {};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolvePrompt.mockResolvedValue({
    systemPrompt: "SYSTEM {{FIELDS}}",
    userPrompt:
      "ISSUE {{ISSUE}}\nCHANGES {{ISSUE_CHANGES}}\nOTHERS {{OTHER_ISSUES}}\nCASES {{CASES}}",
    temperature: 0.2,
    maxOutputTokens: 8000,
    source: "fallback",
    llmIntegrationId: 3,
  });
  mocks.resolveIntegration.mockResolvedValue({ integrationId: 3, model: "m" });
  mocks.withFieldGuidance.mockImplementation(async (t: unknown) => t);
});

describe("fieldsSection", () => {
  it("lists every field but the steps field", () => {
    expect(fieldsSection(template)).toBe("- Priority (Dropdown)");
  });

  it("says so when the template has only steps", () => {
    expect(fieldsSection({ ...template, fields: [template.fields[1]] })).toBe(
      "(this template has no fields besides the steps)"
    );
  });
});

describe("casesSection", () => {
  it("gives the cases as JSON and marks fixed steps", () => {
    const text = casesSection([makeCase(1, { stepsFixed: true })], [], true);
    expect(JSON.parse(text)).toEqual([
      {
        id: 1,
        name: "Case 1",
        fieldValues: {},
        steps: [{ step: "Do it", expectedResult: "Done" }],
        note: "steps are fixed",
      },
    ]);
  });

  it("names the other linked cases and forbids new cases when asked", () => {
    const text = casesSection([makeCase(1)], ["Case 2", "Case 3"], false);
    expect(text).toContain(
      "Other test cases linked to this issue, handled separately (names only):\n- Case 2\n- Case 3"
    );
    expect(text).toContain('Leave "newCases" empty for this request.');
    expect(casesSection([makeCase(1)], [], true)).not.toContain("newCases");
  });
});

describe("reviewCasesAgainstIssue", () => {
  it("reports a project with no AI model without calling one", async () => {
    mocks.resolveIntegration.mockResolvedValue(null);
    expect(await reviewCasesAgainstIssue(db, params([makeCase(1)]))).toEqual({
      ok: false,
      reason: "no_llm",
    });
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it("resolves the upkeep prompt and model for the job's tenant and project", async () => {
    mocks.chat.mockResolvedValue(unchanged([makeCase(1)]));
    await reviewCasesAgainstIssue(db, params([makeCase(1)]));
    expect(mocks.createForWorker).toHaveBeenCalledWith(db, "t1");
    expect(mocks.resolvePrompt).toHaveBeenCalledWith("case_upkeep", 7);
    expect(mocks.resolveIntegration).toHaveBeenCalledWith(
      "case_upkeep",
      7,
      expect.objectContaining({ llmIntegrationId: 3 })
    );
  });

  it("sends the fields, the issue, the other issues and the cases", async () => {
    mocks.withFieldGuidance.mockResolvedValue({
      ...template,
      fields: [{ ...template.fields[0], guidance: "Use High sparingly" }],
    });
    mocks.chat.mockResolvedValue(unchanged([makeCase(1)]));
    await reviewCasesAgainstIssue(
      db,
      params([makeCase(1)], {
        otherIssues: [{ key: "DEMO-7", title: "Tax rules" }],
      })
    );
    const [integrationId, request, retry] = mocks.chat.mock.calls[0];
    expect(integrationId).toBe(3);
    expect(retry).toEqual({ maxRetries: 2, baseDelayMs: 1000 });
    expect(request).toMatchObject({
      temperature: 0.2,
      maxTokens: 8000,
      userId: "system",
      projectId: 7,
      feature: "case_upkeep",
      model: "m",
    });
    expect(request.messages[0].content).toBe(
      "SYSTEM - Priority (Dropdown) guidance: Use High sparingly"
    );
    const user = request.messages[1].content as string;
    expect(user).toContain(
      "ISSUE Key: DEMO-42\nTitle: Checkout totals\nDescription:\nAdd tax"
    );
    expect(user).toContain("CHANGES The earlier text is not available.");
    expect(user).toContain("OTHERS - DEMO-7: Tax rules");
    expect(user).toContain('"name": "Case 1"');
  });

  it("includes the earlier text when it is known", async () => {
    mocks.chat.mockResolvedValue(unchanged([makeCase(1)]));
    await reviewCasesAgainstIssue(
      db,
      params([makeCase(1)], {
        issue: {
          key: "DEMO-42",
          title: "Checkout totals",
          description: "",
          previous: { title: "Checkout", description: "No tax" },
        },
      })
    );
    const user = mocks.chat.mock.calls[0][1].messages[1].content as string;
    expect(user).toContain(
      "CHANGES Before the change the issue read:\nTitle: Checkout\nDescription:\nNo tax"
    );
    expect(user).toContain("Description:\n(none)");
    expect(user).toContain("OTHERS (none)");
  });

  it("cuts an overlong description", async () => {
    mocks.chat.mockResolvedValue(unchanged([makeCase(1)]));
    await reviewCasesAgainstIssue(
      db,
      params([makeCase(1)], {
        issue: {
          key: "K",
          title: "T",
          description: "x".repeat(MAX_ISSUE_TEXT + 50),
        },
      })
    );
    const user = mocks.chat.mock.calls[0][1].messages[1].content as string;
    expect(user).toContain(`${"x".repeat(MAX_ISSUE_TEXT)}\n[cut]`);
    expect(user).not.toContain("x".repeat(MAX_ISSUE_TEXT + 1));
  });

  it("returns the model's decisions and new cases", async () => {
    mocks.chat.mockResolvedValue(
      answer({
        cases: [{ id: 1, action: "retire", reason: "Dropped" }],
        newCases: [{ name: "Lockout", steps: [] }],
      })
    );
    expect(await reviewCasesAgainstIssue(db, params([makeCase(1)]))).toEqual({
      ok: true,
      decisions: [{ caseId: 1, action: "retire", reason: "Dropped" }],
      newCases: [{ name: "Lockout", fieldValues: {}, steps: [] }],
      problems: [],
    });
  });

  it("still asks once when the issue has no linked cases, for new ones", async () => {
    mocks.chat.mockResolvedValue(
      answer({ cases: [], newCases: [{ name: "Lockout" }] })
    );
    const result = await reviewCasesAgainstIssue(db, params([]));
    expect(mocks.chat).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, newCases: [{ name: "Lockout" }] });
  });

  it("splits many cases into requests, and only the first may add cases", async () => {
    const cases = Array.from({ length: CASES_PER_REQUEST + 2 }, (_, i) =>
      makeCase(i + 1)
    );
    mocks.chat
      .mockResolvedValueOnce(
        answer({
          cases: cases
            .slice(0, CASES_PER_REQUEST)
            .map((c) => ({ id: c.id, action: "unchanged" })),
          newCases: [{ name: "From the first" }],
        })
      )
      .mockResolvedValueOnce(
        answer({
          cases: cases
            .slice(CASES_PER_REQUEST)
            .map((c) => ({ id: c.id, action: "retire", reason: "r" })),
          newCases: [{ name: "From the second" }],
        })
      );

    const result = await reviewCasesAgainstIssue(db, params(cases));

    expect(mocks.chat).toHaveBeenCalledTimes(2);
    const first = mocks.chat.mock.calls[0][1].messages[1].content as string;
    const second = mocks.chat.mock.calls[1][1].messages[1].content as string;
    expect(first).toContain(`- Case ${CASES_PER_REQUEST + 1}`);
    expect(first).not.toContain('Leave "newCases" empty');
    expect(second).toContain("- Case 1\n");
    expect(second).toContain('Leave "newCases" empty for this request.');
    if (!result.ok) throw new Error("expected a result");
    expect(result.decisions).toHaveLength(CASES_PER_REQUEST + 2);
    expect(result.decisions.filter((d) => d.action === "retire")).toHaveLength(
      2
    );
    expect(result.newCases).toEqual([
      { name: "From the first", fieldValues: {}, steps: [] },
    ]);
    expect(result.problems).toEqual(["ignored new cases from a later request"]);
  });

  it("says nothing about a later request that adds no cases", async () => {
    const cases = Array.from({ length: CASES_PER_REQUEST + 1 }, (_, i) =>
      makeCase(i + 1)
    );
    mocks.chat
      .mockResolvedValueOnce(unchanged(cases.slice(0, CASES_PER_REQUEST)))
      .mockResolvedValueOnce(unchanged(cases.slice(CASES_PER_REQUEST)));
    const result = await reviewCasesAgainstIssue(db, params(cases));
    if (!result.ok) throw new Error("expected a result");
    expect(result.problems).toEqual([]);
  });

  it("fails when the answer was cut off", async () => {
    mocks.chat.mockResolvedValue({ content: "{", finishReason: "length" });
    expect(await reviewCasesAgainstIssue(db, params([makeCase(1)]))).toEqual({
      ok: false,
      reason: "failed",
      detail: "The model's answer was cut off before it finished",
    });
  });

  it("fails with the model's error, or a plain one when it gives none", async () => {
    mocks.chat.mockRejectedValueOnce(new Error("rate limited"));
    expect(await reviewCasesAgainstIssue(db, params([makeCase(1)]))).toEqual({
      ok: false,
      reason: "failed",
      detail: "rate limited",
    });
    mocks.chat.mockRejectedValueOnce("boom");
    expect(await reviewCasesAgainstIssue(db, params([makeCase(1)]))).toEqual({
      ok: false,
      reason: "failed",
      detail: "The model call failed",
    });
  });

  it("fails when the answer cannot be read", async () => {
    mocks.chat.mockResolvedValue({ content: "no json", finishReason: "stop" });
    expect(await reviewCasesAgainstIssue(db, params([makeCase(1)]))).toEqual({
      ok: false,
      reason: "failed",
      detail: "The model's answer was not valid JSON",
    });
  });

  it("leaves the model out of the request when none is pinned", async () => {
    mocks.resolveIntegration.mockResolvedValue({ integrationId: 3 });
    mocks.chat.mockResolvedValue(unchanged([makeCase(1)]));
    await reviewCasesAgainstIssue(db, params([makeCase(1)]));
    expect(mocks.chat.mock.calls[0][1]).not.toHaveProperty("model");
  });
});
