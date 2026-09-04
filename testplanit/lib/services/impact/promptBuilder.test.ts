import { describe, expect, it } from "vitest";
import { LLM_FEATURES } from "~/lib/llm/constants";
import { FALLBACK_PROMPTS } from "~/lib/llm/services/fallback-prompts";
import {
  buildUserPrompt,
  compressCase,
  estimateFixedPromptTokens,
  serializeCasesPositional,
  substituteVariables,
  type CompressionLimits,
  type ImpactPromptContext,
} from "./promptBuilder";

const TEMPLATE = FALLBACK_PROMPTS[LLM_FEATURES.IMPACT_ANALYSIS].userPrompt;
const SYSTEM = FALLBACK_PROMPTS[LLM_FEATURES.IMPACT_ANALYSIS].systemPrompt;

const LIMITS: CompressionLimits = {
  truncateCaseName: 10,
  truncateTextLong: 12,
  truncateOtherField: 8,
};

function baseContext(
  overrides: Partial<ImpactPromptContext> = {}
): ImpactPromptContext {
  return {
    baseSha: "abcdef1234567890",
    headSha: "1234567abcdef890",
    diffText: "M lib/auth.ts\n  +login()",
    changedFileCount: 1,
    excludedCount: 0,
    pinnedCaseIds: [],
    candidates: [
      { id: 1, name: "Login works", folderPath: "/Auth" },
      { id: 2, name: "Logout" },
    ],
    batchIndex: 0,
    batchCount: 1,
    ...overrides,
  };
}

describe("substituteVariables", () => {
  it("inserts values literally, including $& and $1", () => {
    const out = substituteVariables("A={{X}} B={{Y}}", {
      X: "cost $& and $1 and $$",
      Y: "y",
    });
    expect(out).toBe("A=cost $& and $1 and $$ B=y");
  });

  it("does not re-expand placeholders found inside values", () => {
    const out = substituteVariables("A={{X}} B={{Y}}", {
      X: "{{Y}}",
      Y: "y",
    });
    expect(out).toBe("A={{Y}} B=y");
  });

  it("leaves unknown placeholders in place", () => {
    expect(substituteVariables("{{KNOWN}} {{UNKNOWN}}", { KNOWN: "k" })).toBe(
      "k {{UNKNOWN}}"
    );
  });

  it("replaces every occurrence", () => {
    expect(substituteVariables("{{A}}-{{A}}", { A: "x" })).toBe("x-x");
  });
});

describe("serializeCasesPositional", () => {
  it("emits one row per line and trims trailing nulls", () => {
    const out = serializeCasesPositional([
      { id: 1, name: "A" },
      { id: 2, name: "B", folderPath: "/Auth/Login" },
      { id: 3, name: "C", tags: ["smoke"] },
      { id: 4, name: "D", folderPath: "/", fields: { Priority: "High" } },
      { id: 5, name: "E", tags: [], fields: {} },
    ]);
    expect(out.split("\n")).toEqual([
      '[1,"A"]',
      '[2,"B","/Auth/Login"]',
      '[3,"C",null,["smoke"]]',
      '[4,"D",null,null,{"Priority":"High"}]',
      '[5,"E"]',
    ]);
  });

  it("returns an empty string for no candidates", () => {
    expect(serializeCasesPositional([])).toBe("");
  });
});

describe("buildUserPrompt", () => {
  it("renders the minimal form with empty optional sections", () => {
    const out = buildUserPrompt(TEMPLATE, baseContext());
    expect(out).toContain("CODE CHANGE: abcdef1 -> 1234567");
    expect(out).not.toContain("TESTER NOTES");
    expect(out).not.toContain("excluded");
    expect(out).not.toContain("Code Pins");
    expect(out).toContain("CHANGED FILES (1 included):");
    expect(out).toContain("CANDIDATE TEST CASES (2 cases):");
    expect(out).toContain('[1,"Login works","/Auth"]\n[2,"Logout"]');
  });

  it("renders notes, excluded files, pins and batch position", () => {
    const out = buildUserPrompt(
      TEMPLATE,
      baseContext({
        notes: "  Focus on login  ",
        excludedCount: 2,
        pinnedCaseIds: [12, 87],
        batchIndex: 1,
        batchCount: 3,
      })
    );
    expect(out).toMatchInlineSnapshot(`
      "CODE CHANGE: abcdef1 -> 1234567

      TESTER NOTES:
      Focus on login

      CHANGED FILES (1 included, 2 excluded: lockfiles/generated/binary):
      M lib/auth.ts
        +login()

      Already selected by Code Pins (do not re-select): [12, 87]
      CANDIDATE TEST CASES (2 cases, batch 2 of 3):
      Format: [id, name, folder?, tags[]?, fields?]
      [1,"Login works","/Auth"]
      [2,"Logout"]

      Select the cases to run for this change and list the changed files no candidate covers. Return ONLY the JSON object."
    `);
  });

  it("omits the notes section for whitespace-only notes", () => {
    const out = buildUserPrompt(TEMPLATE, baseContext({ notes: "   \n" }));
    expect(out).not.toContain("TESTER NOTES");
  });

  it("keeps regex replacement patterns in the diff literal", () => {
    const out = buildUserPrompt(
      TEMPLATE,
      baseContext({ diffText: "+  return s.replace(/x/, '$&$1');" })
    );
    expect(out).toContain("+  return s.replace(/x/, '$&$1');");
  });
});

describe("estimateFixedPromptTokens", () => {
  it("grows with the diff and covers the template boilerplate", () => {
    const small = estimateFixedPromptTokens(SYSTEM, TEMPLATE, "M a.ts");
    const large = estimateFixedPromptTokens(SYSTEM, TEMPLATE, "x".repeat(4000));
    expect(small).toBeGreaterThan(Math.ceil(SYSTEM.length / 4));
    expect(large - small).toBeGreaterThanOrEqual(990);
  });
});

describe("compressCase", () => {
  it("truncates the name with an ellipsis and drops empty sections", () => {
    const out = compressCase(
      { id: 7, name: "A very long case name", folder: null, caseTags: [] },
      LIMITS
    );
    expect(out).toEqual({ id: 7, name: "A very lon…" });
  });

  it("keeps short names intact", () => {
    expect(compressCase({ id: 1, name: "Short" }, LIMITS)).toEqual({
      id: 1,
      name: "Short",
    });
  });

  it("builds the folder path from the nested parent chain", () => {
    const out = compressCase(
      {
        id: 1,
        name: "Case",
        folder: { name: "Login", parent: { name: "Auth", parent: null } },
      },
      LIMITS
    );
    expect(out.folderPath).toBe("/Auth/Login");
  });

  it("collects tag names", () => {
    const out = compressCase(
      {
        id: 1,
        name: "Case",
        caseTags: [{ tag: { name: "smoke" } }, { tag: { name: "auth" } }],
      },
      LIMITS
    );
    expect(out.tags).toEqual(["smoke", "auth"]);
  });

  it("resolves field values by type and skips Steps, empties and unnamed fields", () => {
    const options = [
      { fieldOption: { id: 1, name: "High" } },
      { fieldOption: { id: 2, name: "Low" } },
    ];
    const out = compressCase(
      {
        id: 1,
        name: "Case",
        caseFieldValues: [
          {
            value: 1,
            field: {
              displayName: "Priority",
              type: { type: "Select" },
              fieldOptions: options,
            },
          },
          {
            value: "[1,2]",
            field: {
              displayName: "Labels",
              type: { type: "Multi-Select" },
              fieldOptions: options,
            },
          },
          {
            value: JSON.stringify({
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Precondition text here" }],
                },
              ],
            }),
            field: {
              displayName: "Preconditions",
              type: { type: "Text Long" },
            },
          },
          {
            value: [{ step: "do" }],
            field: { displayName: "Steps", type: { type: "Steps" } },
          },
          {
            value: "2024-01-01T00:00:00Z",
            field: { displayName: "Date", type: { type: "Date" } },
          },
          {
            value: "",
            field: { displayName: "Empty", type: { type: "Text" } },
          },
          {
            value: 42,
            field: { systemName: "estimate", type: { type: "Integer" } },
          },
          { value: "x", field: { type: { type: "Text" } } },
        ],
      },
      LIMITS
    );
    expect(out.fields).toEqual({
      Priority: "High",
      Labels: "High, Low",
      Preconditions: "Precondition…",
      Date: "2024-01-…",
      estimate: "42",
    });
  });
});
