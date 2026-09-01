// Source-contract pins for the promotion picker mode (`promotableOnly`).
// The dialog itself is a 1,000-line fork with tracker/search/create deps
// (RequirementReferencesPanel.test.tsx exercises it only as a mocked
// child), so — like GenerateTestCasesWizard.test.tsx — the cheap, durable
// guard is a structural one: the three gates the mode adds must all stay
// wired to the SAME prop, or a promotion picker could silently offer a
// tracker search whose picks have no local row to promote.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIALOG_PATH = path.join(
  __dirname,
  "requirement-reference-search-dialog.tsx"
);

function readDialog(): string {
  return readFileSync(DIALOG_PATH, "utf8");
}

describe("RequirementReferenceSearchDialog — promotableOnly mode", () => {
  it("restricts the internal query to synced rows while keeping the defect-role scope", () => {
    const src = readDialog();
    // The synced pin sits INSIDE the same where object as the role scope:
    // a promotion target is a synced non-requirement, never a native
    // defect (the override route 400s those).
    expect(src).toMatch(
      /\.\.\.\(includeRequirements \? \{\} : DEFECT_SCOPE_WHERE\),[\s\S]{0,300}?\.\.\.\(promotableOnly \? \{ integrationId: \{ not: null \} \} : \{\}\)/
    );
  });

  it("never auto-switches to the tracker source in promotion mode", () => {
    const src = readDialog();
    expect(src).toMatch(
      /if \(activeIntegrationId && !promotableOnly\) \{\s*setSearchExternal\(true\);/
    );
  });

  it("hides both the source toggle and the create-new-issue affordance", () => {
    const src = readDialog();
    expect(src).toMatch(/\{activeIntegration && !promotableOnly && \(/);
    expect(src).toMatch(
      /\{activeIntegration && !authError && !promotableOnly && \(/
    );
  });
});
