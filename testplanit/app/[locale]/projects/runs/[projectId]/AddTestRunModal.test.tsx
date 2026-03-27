/**
 * Tests for the wizard back-button form preservation logic.
 *
 * The AddTestRunModal uses a two-form architecture:
 * - Parent form: persists across wizard steps (useForm in AddTestRunModal)
 * - BasicInfoDialog form: created fresh on each mount, reads defaults from parent form
 *
 * When navigating forward (step 0 → 1): BasicInfoDialog syncs values to parent form
 * When navigating back (step 1 → 0): BasicInfoDialog remounts and reads from parent form
 *
 * These tests verify the sync logic that makes back-navigation preserve form state.
 */

import { describe, expect, it } from "vitest";

/**
 * Simulate the handleNextStep sync logic from BasicInfoDialog (lines 188-196).
 * This is the critical code path that saves form values before advancing.
 */
function syncBasicInfoToParentForm(
  basicInfoValues: Record<string, any>,
  parentForm: Record<string, any>
) {
  parentForm.milestoneId = basicInfoValues.milestoneId;
  parentForm.configIds = basicInfoValues.configIds;
  Object.keys(basicInfoValues).forEach((key) => {
    if (key !== "milestoneId" && key !== "configIds") {
      parentForm[key] = basicInfoValues[key];
    }
  });
  return parentForm;
}

/**
 * Simulate the BasicInfoDialog defaultValues initialization (lines 146-154).
 * This is what runs when the user navigates back and BasicInfoDialog remounts.
 */
function initBasicInfoDefaults(
  parentForm: Record<string, any>,
  defaultWorkflowId: number
) {
  return {
    name: parentForm.name,
    configIds: parentForm.configIds,
    milestoneId: parentForm.milestoneId,
    stateId: parentForm.stateId || defaultWorkflowId,
    note: parentForm.note,
    docs: parentForm.docs,
    attachments: parentForm.attachments,
  };
}

describe("AddTestRunModal - Back Button Form Preservation Logic", () => {
  const emptyEditorContent = { type: "doc", content: [] };
  const defaultWorkflowId = 10;

  it("preserves name after forward sync + back re-init", () => {
    const parentForm: Record<string, any> = {
      name: "",
      configIds: [],
      milestoneId: null,
      stateId: defaultWorkflowId,
      note: JSON.stringify(emptyEditorContent),
      docs: JSON.stringify(emptyEditorContent),
      attachments: [],
    };

    // User fills in name in BasicInfoDialog
    const basicInfoValues = {
      name: "My Sprint Test Run",
      configIds: [],
      milestoneId: null,
      stateId: defaultWorkflowId,
      note: JSON.stringify(emptyEditorContent),
      docs: JSON.stringify(emptyEditorContent),
      attachments: [],
    };

    // Forward sync (handleNextStep)
    syncBasicInfoToParentForm(basicInfoValues, parentForm);

    // Back navigation: BasicInfoDialog remounts and reads defaults
    const restored = initBasicInfoDefaults(parentForm, defaultWorkflowId);

    expect(restored.name).toBe("My Sprint Test Run");
  });

  it("preserves workflow state selection after forward sync + back re-init", () => {
    const parentForm: Record<string, any> = {
      name: "",
      configIds: [],
      milestoneId: null,
      stateId: defaultWorkflowId,
      note: JSON.stringify(emptyEditorContent),
      docs: JSON.stringify(emptyEditorContent),
      attachments: [],
    };

    // User changes state to "In Progress" (id=11)
    const basicInfoValues = {
      name: "State Test",
      configIds: [],
      milestoneId: null,
      stateId: 11,
      note: JSON.stringify(emptyEditorContent),
      docs: JSON.stringify(emptyEditorContent),
      attachments: [],
    };

    syncBasicInfoToParentForm(basicInfoValues, parentForm);
    const restored = initBasicInfoDefaults(parentForm, defaultWorkflowId);

    // Should be 11 (user selection), NOT 10 (default workflow)
    expect(restored.stateId).toBe(11);
  });

  it("falls back to default workflow when stateId is not set", () => {
    const parentForm: Record<string, any> = {
      name: "",
      configIds: [],
      milestoneId: null,
      stateId: undefined, // No state set
      note: JSON.stringify(emptyEditorContent),
      docs: JSON.stringify(emptyEditorContent),
      attachments: [],
    };

    const restored = initBasicInfoDefaults(parentForm, defaultWorkflowId);

    expect(restored.stateId).toBe(defaultWorkflowId);
  });

  it("preserves configuration selection after forward sync + back re-init", () => {
    const parentForm: Record<string, any> = {
      name: "",
      configIds: [],
      milestoneId: null,
      stateId: defaultWorkflowId,
      note: JSON.stringify(emptyEditorContent),
      docs: JSON.stringify(emptyEditorContent),
      attachments: [],
    };

    // User selects Chrome (1) and Firefox (2)
    const basicInfoValues = {
      name: "Config Test",
      configIds: [1, 2],
      milestoneId: null,
      stateId: defaultWorkflowId,
      note: JSON.stringify(emptyEditorContent),
      docs: JSON.stringify(emptyEditorContent),
      attachments: [],
    };

    syncBasicInfoToParentForm(basicInfoValues, parentForm);
    const restored = initBasicInfoDefaults(parentForm, defaultWorkflowId);

    expect(restored.configIds).toEqual([1, 2]);
  });

  it("preserves milestone selection after forward sync + back re-init", () => {
    const parentForm: Record<string, any> = {
      name: "",
      configIds: [],
      milestoneId: null,
      stateId: defaultWorkflowId,
      note: JSON.stringify(emptyEditorContent),
      docs: JSON.stringify(emptyEditorContent),
      attachments: [],
    };

    const basicInfoValues = {
      name: "Milestone Test",
      configIds: [],
      milestoneId: 42,
      stateId: defaultWorkflowId,
      note: JSON.stringify(emptyEditorContent),
      docs: JSON.stringify(emptyEditorContent),
      attachments: [],
    };

    syncBasicInfoToParentForm(basicInfoValues, parentForm);
    const restored = initBasicInfoDefaults(parentForm, defaultWorkflowId);

    expect(restored.milestoneId).toBe(42);
  });

  it("preserves documentation (TipTap object) after forward sync + back re-init", () => {
    const parentForm: Record<string, any> = {
      name: "",
      configIds: [],
      milestoneId: null,
      stateId: defaultWorkflowId,
      note: JSON.stringify(emptyEditorContent),
      docs: JSON.stringify(emptyEditorContent),
      attachments: [],
    };

    const richDocs = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Important documentation" }],
        },
      ],
    };

    // TipTap onUpdate stores object directly (not stringified)
    const basicInfoValues = {
      name: "Docs Test",
      configIds: [],
      milestoneId: null,
      stateId: defaultWorkflowId,
      note: JSON.stringify(emptyEditorContent),
      docs: richDocs,
      attachments: [],
    };

    syncBasicInfoToParentForm(basicInfoValues, parentForm);
    const restored = initBasicInfoDefaults(parentForm, defaultWorkflowId);

    // Docs should be the TipTap object, not empty
    expect(restored.docs).toEqual(richDocs);
    expect(restored.docs.content[0].content[0].text).toBe(
      "Important documentation"
    );
  });

  it("preserves note/description (TipTap object) after forward sync + back re-init", () => {
    const parentForm: Record<string, any> = {
      name: "",
      configIds: [],
      milestoneId: null,
      stateId: defaultWorkflowId,
      note: JSON.stringify(emptyEditorContent),
      docs: JSON.stringify(emptyEditorContent),
      attachments: [],
    };

    const richNote = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Sprint regression notes" }],
        },
      ],
    };

    const basicInfoValues = {
      name: "Note Test",
      configIds: [],
      milestoneId: null,
      stateId: defaultWorkflowId,
      note: richNote,
      docs: JSON.stringify(emptyEditorContent),
      attachments: [],
    };

    syncBasicInfoToParentForm(basicInfoValues, parentForm);
    const restored = initBasicInfoDefaults(parentForm, defaultWorkflowId);

    expect(restored.note).toEqual(richNote);
  });

  it("preserves all fields together after forward sync + back re-init", () => {
    const parentForm: Record<string, any> = {
      name: "",
      configIds: [],
      milestoneId: null,
      stateId: defaultWorkflowId,
      note: JSON.stringify(emptyEditorContent),
      docs: JSON.stringify(emptyEditorContent),
      attachments: [],
    };

    const richNote = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Full form test note" }],
        },
      ],
    };
    const richDocs = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Full form test docs" }],
        },
      ],
    };

    const basicInfoValues = {
      name: "Full Form Test",
      configIds: [1, 2],
      milestoneId: 42,
      stateId: 11,
      note: richNote,
      docs: richDocs,
      attachments: [],
    };

    syncBasicInfoToParentForm(basicInfoValues, parentForm);
    const restored = initBasicInfoDefaults(parentForm, defaultWorkflowId);

    expect(restored.name).toBe("Full Form Test");
    expect(restored.configIds).toEqual([1, 2]);
    expect(restored.milestoneId).toBe(42);
    expect(restored.stateId).toBe(11);
    expect(restored.note).toEqual(richNote);
    expect(restored.docs).toEqual(richDocs);
  });
});
