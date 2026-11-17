import { describe, expect, it } from "vitest";

import { shouldResetCaseForm } from "./caseFormReset";

const base = {
  isEditMode: true,
  selectedTemplateId: 3,
  lastResetTemplateId: 3,
  hasCarriedValues: false,
};

describe("shouldResetCaseForm", () => {
  it("keeps the user's edits when the case refetches mid-edit", () => {
    expect(shouldResetCaseForm(base)).toBe(false);
  });

  it("resets on the first run, before the form was ever reset", () => {
    expect(
      shouldResetCaseForm({ ...base, lastResetTemplateId: undefined })
    ).toBe(true);
  });

  it("resets on the first run even for a case with no template", () => {
    expect(
      shouldResetCaseForm({
        ...base,
        selectedTemplateId: null,
        lastResetTemplateId: undefined,
      })
    ).toBe(true);
  });

  it("resets when the template changes mid-edit", () => {
    expect(shouldResetCaseForm({ ...base, selectedTemplateId: 4 })).toBe(true);
  });

  it("resets when a picker switch carries values over", () => {
    expect(shouldResetCaseForm({ ...base, hasCarriedValues: true })).toBe(true);
  });

  it("always follows the saved case outside edit mode", () => {
    expect(shouldResetCaseForm({ ...base, isEditMode: false })).toBe(true);
  });
});
