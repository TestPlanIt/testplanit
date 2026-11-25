import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { workflowIdsForNewProject } from "./newProjectWorkflows";

describe("workflowIdsForNewProject", () => {
  it("adds the switched-off AI-draft states to the ones the admin picked", () => {
    expect(workflowIdsForNewProject([3, 5], [{ id: 9 }])).toEqual([3, 5, 9]);
  });

  it("gives the picked states alone when no AI-draft state is switched off", () => {
    expect(workflowIdsForNewProject([3, 5], [])).toEqual([3, 5]);
    expect(workflowIdsForNewProject([3, 5], undefined)).toEqual([3, 5]);
    expect(workflowIdsForNewProject([3, 5], null)).toEqual([3, 5]);
  });

  it("names a state once", () => {
    expect(workflowIdsForNewProject([3, 9, 3], [{ id: 9 }, { id: 9 }])).toEqual(
      [3, 9]
    );
  });

  it("gives the switched-off AI-draft states even when nothing was picked", () => {
    expect(workflowIdsForNewProject([], [{ id: 9 }])).toEqual([9]);
  });
});

// The wizard is too large to render in this lane, so its wiring is asserted on
// its source, the way utils/caseIssueLinkWrite.test.ts does for the case page.
describe("the project wizard assigns them", () => {
  const WIZARD = "app/[locale]/admin/projects/CreateProjectWizard.tsx";
  const source = readFileSync(WIZARD, "utf8");

  it("reads the AI-draft test case states that are switched off", () => {
    expect(source).toMatch(
      /isEnabled: false,\s*isAiDraft: true,\s*scope: WorkflowScope\.CASES/
    );
  });

  it("assigns workflowIdsForNewProject, not the picked states alone", () => {
    expect(source).toContain(
      "workflowIdsForNewProject(\n        data.selectedWorkflows,\n        switchedOffAiDraftStates\n      )"
    );
    expect(source).not.toContain("data: data.selectedWorkflows.map(");
  });
});
