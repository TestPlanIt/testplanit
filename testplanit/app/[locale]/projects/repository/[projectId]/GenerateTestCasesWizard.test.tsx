/**
 * INT-06 wizard plumbing tests.
 *
 * The wizard is 5,400+ lines of React with deeply-nested useState + form +
 * streaming logic and many ZenStack/integration dependencies. Spinning up a
 * full Testing-Library render harness would require mocking ~30 modules and
 * still wouldn't reach the preview UI deterministically (the cards only
 * render after a multi-step interaction).
 *
 * Instead, this test file performs structural / contract checks:
 *   1. The wizard source contains the admin-gated toggle (defense in depth on
 *      top of the API admin gate).
 *   2. All four LLM fetch sites thread `includeParameters` into the POST body.
 *   3. The parser warnings setter is wired and reset between generations.
 *
 * The behavioral coverage (toggle visible to admins, body threading, dataset
 * truncation rendering) is exercised end-to-end by the Playwright spec at
 * e2e/tests/llm/generate-cases-with-parameters.spec.ts. The route layer's
 * threading is already covered by route.test.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WIZARD_PATH = path.join(__dirname, "GenerateTestCasesWizard.tsx");

function readWizard(): string {
  return readFileSync(WIZARD_PATH, "utf8");
}

describe("GenerateTestCasesWizard — INT-06 plumbing", () => {
  it("declares the includeParameters state with default false (D-10 opt-in)", () => {
    const src = readWizard();
    expect(src).toMatch(
      /const \[includeParameters, setIncludeParameters\] = useState\(false\)/
    );
  });

  it("derives isAdmin from the session.user.access pattern (canonical admin check)", () => {
    const src = readWizard();
    expect(src).toMatch(
      /const isAdmin = session\?\.user\?\.access === "ADMIN"/
    );
  });

  it("renders the include-parameters toggle ONLY when isAdmin is truthy", () => {
    const src = readWizard();
    // The conditional render must reference both isAdmin and the testid.
    expect(src).toMatch(
      /\{isAdmin &&[\s\S]*?data-testid="include-parameters-toggle"/
    );
  });

  it("threads includeParameters into the stream POST body (single-shot path)", () => {
    const src = readWizard();
    // The stream fetch body must include `includeParameters` alongside
    // `autoGenerateTags`.
    const streamFetchIdx = src.indexOf(
      'fetch("/api/llm/generate-test-cases/stream"'
    );
    expect(streamFetchIdx).toBeGreaterThan(-1);
    const streamSnippet = src.slice(streamFetchIdx, streamFetchIdx + 1500);
    expect(streamSnippet).toMatch(/autoGenerateTags,\s*\n\s*includeParameters/);
  });

  it("threads includeParameters into the expand POST body", () => {
    const src = readWizard();
    const expandFetchIdx = src.indexOf('"/api/llm/generate-test-cases/expand"');
    expect(expandFetchIdx).toBeGreaterThan(-1);
    const expandSnippet = src.slice(expandFetchIdx, expandFetchIdx + 1500);
    expect(expandSnippet).toMatch(
      /autoGenerateTags,\s*\n\s*includeParameters,/
    );
  });

  it("threads includeParameters into the outline POST body (accepted-but-ignored)", () => {
    const src = readWizard();
    const outlineFetchIdx = src.indexOf(
      '"/api/llm/generate-test-cases/outline"'
    );
    expect(outlineFetchIdx).toBeGreaterThan(-1);
    const outlineSnippet = src.slice(outlineFetchIdx, outlineFetchIdx + 1000);
    expect(outlineSnippet).toMatch(/includeParameters,?\s*\n/);
  });

  it("threads includeParameters into the URL-job submit POST body", () => {
    const src = readWizard();
    const urlFetchIdx = src.indexOf('"/api/llm/generate-from-url/submit"');
    expect(urlFetchIdx).toBeGreaterThan(-1);
    const urlSnippet = src.slice(urlFetchIdx, urlFetchIdx + 1500);
    expect(urlSnippet).toMatch(
      /includeParameters: includeParameters \|\| undefined/
    );
  });

  it("captures parser warnings from parseAndValidateTestCases and resets between generations", () => {
    const src = readWizard();
    // The parser callsite destructures `warnings` alongside `testCases`.
    expect(src).toMatch(
      /warnings:\s*pageWarnings\s*,?\s*\}\s*=\s*parseAndValidateTestCases/
    );
    // The reset happens at the top of a fresh `generateTestCases` invocation.
    expect(src).toMatch(/setLlmWarnings\(\[\]\)/);
  });

  it("renders the parameters and starter-dataset preview sections with data-testids", () => {
    const src = readWizard();
    expect(src).toContain('data-testid="wizard-preview-parameters-section"');
    expect(src).toContain('data-testid="wizard-preview-dataset-section"');
    expect(src).toContain('data-testid="wizard-preview-parameter-chip"');
    expect(src).toContain('data-testid="wizard-preview-warning"');
  });

  it("references the new i18n keys for the toggle label, help, and warning copy", () => {
    const src = readWizard();
    expect(src).toContain("generateTestCases.includeParametersLabel");
    expect(src).toContain("generateTestCases.includeParametersHelp");
    expect(src).toContain("generateTestCases.parametersSection");
    expect(src).toContain("generateTestCases.starterDatasetSection");
    expect(src).toContain("generateTestCases.datasetTruncatedWarning");
  });
});

describe("GenerateTestCasesWizard — case-field eligibility", () => {
  it("filters the template caseFields query to enabled, non-deleted fields", () => {
    const src = readWizard();
    // The templates query must constrain caseFields to fields that are still
    // enabled and not soft-deleted so disabled/deleted fields are never
    // selectable for generation.
    expect(src).toMatch(
      /caseField:\s*\{\s*isEnabled:\s*true,\s*isDeleted:\s*false\s*\}/
    );
  });

  it("reads the TestCaseRestrictedFields add/edit permission", () => {
    const src = readWizard();
    expect(src).toMatch(
      /useProjectPermissions\(\s*projectId,\s*ApplicationArea\.TestCaseRestrictedFields\s*\)/
    );
    // Super admins bypass; everyone else needs explicit add/edit.
    expect(src).toMatch(
      /const canEditRestrictedFields =\s*\(restrictedFieldsPermissions\?\.canAddEdit \?\? false\) \|\| isAdmin/
    );
  });

  it("gates restricted fields on canEditRestrictedFields via isTemplateFieldVisible", () => {
    const src = readWizard();
    // The predicate hides disabled/deleted fields and any restricted field the
    // user lacks permission to edit.
    expect(src).toMatch(
      /const isTemplateFieldVisible = useCallback\([\s\S]*?isRestricted \|\| canEditRestrictedFields/
    );
  });

  it("applies the visibility filter to selection, auto-select, and restore paths", () => {
    const src = readWizard();
    // Only visible fields are ever added to selectedFieldIds or rendered in
    // the field-selection list.
    const matches = src.match(/\.filter\(isTemplateFieldVisible\)/g) ?? [];
    // field-selection list + selectAllFields + auto-select effect + sanitizer
    // + restoreTemplateFromResult.
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });
});

describe("en-US.json — INT-06 i18n keys", () => {
  it("contains all new generateTestCases keys", () => {
    const en = JSON.parse(
      readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "..",
          "..",
          "messages",
          "en-US.json"
        ),
        "utf8"
      )
    );
    const ns = en.repository.generateTestCases;
    expect(typeof ns.includeParametersLabel).toBe("string");
    expect(typeof ns.includeParametersHelp).toBe("string");
    expect(typeof ns.parametersSection).toBe("string");
    expect(typeof ns.starterDatasetSection).toBe("string");
    expect(typeof ns.datasetTruncatedWarning).toBe("string");
    expect(typeof ns.datasetCappedWarning).toBe("string");
    expect(typeof ns.invalidParameterWarning).toBe("string");
    expect(typeof ns.datasetMoreRows).toBe("string");
    expect(typeof ns.parameterChipSensitive).toBe("string");
  });
});
