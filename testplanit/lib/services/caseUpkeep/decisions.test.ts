import { describe, expect, it } from "vitest";
import type { UpkeepCase } from "./caseText";
import { MAX_NEW_CASES, parseUpkeepResponse } from "./decisions";

const cases: UpkeepCase[] = [
  {
    id: 12,
    name: "Totals add up",
    fieldValues: { Priority: "High", Notes: "Smoke" },
    steps: [{ step: "Open the cart", expectedResult: "Total is shown" }],
    stepsFixed: false,
  },
  {
    id: 13,
    name: "Remember me keeps the session",
    fieldValues: {},
    steps: [{ step: "Tick Remember me", expectedResult: "" }],
    stepsFixed: false,
  },
  {
    id: 14,
    name: "Shared login",
    fieldValues: {},
    steps: [{ step: "Log in", expectedResult: "Dashboard" }],
    stepsFixed: true,
  },
];
const fields = ["Priority", "Notes"];

const parse = (answer: unknown, given = cases) =>
  parseUpkeepResponse(
    typeof answer === "string" ? answer : JSON.stringify(answer),
    given,
    fields
  );

const ok = (answer: unknown, given = cases) => {
  const result = parse(answer, given);
  if (!result.ok) throw new Error(result.error);
  return result;
};

describe("parseUpkeepResponse", () => {
  it("reads unchanged, update and retire decisions", () => {
    const result = ok({
      cases: [
        {
          id: 12,
          action: "update",
          reason: "Tax is now included",
          name: "Totals include tax",
          fieldValues: { Priority: "Low" },
          steps: [
            {
              step: "Open the cart",
              expectedResult: "Total with tax is shown",
            },
          ],
        },
        { id: 13, action: "retire", reason: "Remember me was dropped" },
        { id: 14, action: "unchanged" },
      ],
    });
    expect(result.decisions).toEqual([
      {
        caseId: 12,
        action: "update",
        reason: "Tax is now included",
        proposed: {
          name: "Totals include tax",
          fieldValues: { Priority: "Low", Notes: "Smoke" },
          steps: [
            {
              step: "Open the cart",
              expectedResult: "Total with tax is shown",
            },
          ],
        },
      },
      { caseId: 13, action: "retire", reason: "Remember me was dropped" },
      { caseId: 14, action: "unchanged" },
    ]);
    expect(result.newCases).toEqual([]);
    expect(result.problems).toEqual([]);
  });

  it("accepts an answer wrapped in a code fence or prose", () => {
    const body = JSON.stringify({
      cases: cases.map((c) => ({ id: c.id, action: "unchanged" })),
    });
    expect(ok("```json\n" + body + "\n```").decisions).toHaveLength(3);
    expect(ok("Here you go: " + body).decisions).toHaveLength(3);
  });

  it("fails on an answer that is not a JSON object", () => {
    expect(parse("I could not decide")).toEqual({
      ok: false,
      error: "The model's answer was not valid JSON",
    });
    expect(parse("{ not json }").ok).toBe(false);
  });

  it("leaves a case the answer skips unchanged and says so", () => {
    const result = ok({ cases: [{ id: 12, action: "unchanged" }] });
    expect(result.decisions.map((d) => d.action)).toEqual([
      "unchanged",
      "unchanged",
      "unchanged",
    ]);
    expect(result.problems).toEqual([
      "no answer for case 13",
      "no answer for case 14",
    ]);
  });

  it("ignores answers for cases it was not given and second answers", () => {
    const result = ok({
      cases: [
        { id: 999, action: "retire", reason: "x" },
        { id: 12, action: "unchanged" },
        { id: 12, action: "retire", reason: "x" },
        { id: 13, action: "unchanged" },
        { id: 14, action: "unchanged" },
      ],
    });
    expect(result.decisions.every((d) => d.action === "unchanged")).toBe(true);
    expect(result.problems).toEqual([
      "ignored an answer for unknown case 999",
      "ignored a second answer for case 12",
    ]);
  });

  it("treats an unknown action as unchanged", () => {
    const result = ok({ cases: [{ id: 12, action: "delete" }] }, [cases[0]]);
    expect(result.decisions).toEqual([{ caseId: 12, action: "unchanged" }]);
    expect(result.problems).toEqual(["unknown action for case 12: delete"]);
  });

  it("keeps what an update leaves out", () => {
    const result = ok(
      { cases: [{ id: 12, action: "update", name: "Totals include tax" }] },
      [cases[0]]
    );
    expect(result.decisions[0]).toEqual({
      caseId: 12,
      action: "update",
      reason: "",
      proposed: {
        name: "Totals include tax",
        fieldValues: { Priority: "High", Notes: "Smoke" },
        steps: cases[0].steps,
      },
    });
  });

  it("drops fields the template does not have and empty steps", () => {
    const result = ok(
      {
        cases: [
          {
            id: 12,
            action: "update",
            fieldValues: { Severity: "Blocker", Notes: null, Priority: "Low" },
            steps: [
              { step: "  ", expectedResult: "nothing" },
              { step: "Open the cart" },
              "not a step",
            ],
          },
        ],
      },
      [cases[0]]
    );
    expect(result.decisions[0]).toMatchObject({
      action: "update",
      proposed: {
        fieldValues: { Priority: "Low", Notes: "Smoke" },
        steps: [{ step: "Open the cart", expectedResult: "" }],
      },
    });
  });

  it("never changes the steps of a case whose steps are fixed", () => {
    const result = ok(
      {
        cases: [
          {
            id: 14,
            action: "update",
            name: "Shared login with SSO",
            steps: [{ step: "Something else", expectedResult: "" }],
          },
        ],
      },
      [cases[2]]
    );
    expect(result.decisions[0]).toMatchObject({
      action: "update",
      proposed: { name: "Shared login with SSO", steps: cases[2].steps },
    });
  });

  it("counts an update that changes nothing as unchanged", () => {
    const result = ok(
      {
        cases: [
          {
            id: 12,
            action: "update",
            reason: "No real change",
            name: "Totals add up",
            fieldValues: { Notes: "Smoke", Priority: "High" },
            steps: [
              { step: "Open the cart", expectedResult: "Total is shown" },
            ],
          },
        ],
      },
      [cases[0]]
    );
    expect(result.decisions).toEqual([{ caseId: 12, action: "unchanged" }]);
  });

  it("shortens a long reason", () => {
    const result = ok(
      { cases: [{ id: 13, action: "retire", reason: "x".repeat(900) }] },
      [cases[1]]
    );
    expect((result.decisions[0] as { reason: string }).reason).toHaveLength(
      500
    );
  });

  it("reads new cases, skipping ones without a name", () => {
    const result = ok({
      cases: [],
      newCases: [
        {
          name: "Account locks after 5 failures",
          fieldValues: { Priority: "High", Unknown: "x" },
          steps: [{ step: "Fail to log in 5 times", expectedResult: "Locked" }],
        },
        { fieldValues: {} },
        { name: "No steps given" },
      ],
    });
    expect(result.newCases).toEqual([
      {
        name: "Account locks after 5 failures",
        fieldValues: { Priority: "High" },
        steps: [{ step: "Fail to log in 5 times", expectedResult: "Locked" }],
      },
      { name: "No steps given", fieldValues: {}, steps: [] },
    ]);
    expect(result.problems).toContain("ignored a new case without a name");
  });

  it("caps the number of new cases", () => {
    const result = ok({
      cases: [],
      newCases: Array.from({ length: MAX_NEW_CASES + 3 }, (_, i) => ({
        name: `Case ${i}`,
      })),
    });
    expect(result.newCases).toHaveLength(MAX_NEW_CASES);
    expect(result.problems).toContain(
      `ignored new cases beyond ${MAX_NEW_CASES}`
    );
  });

  it("tolerates missing or malformed lists", () => {
    const result = ok({ cases: "none", newCases: 4 }, [cases[0]]);
    expect(result.decisions).toEqual([{ caseId: 12, action: "unchanged" }]);
    expect(result.newCases).toEqual([]);
    expect(parse("[]").ok).toBe(false);
  });
});
