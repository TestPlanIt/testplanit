/**
 * The test-case-generation system prompt exists in three copies: the inline
 * default in shared.ts, FALLBACK_PROMPTS here, and the seeded "Default"
 * promptConfig. Deselecting a field appends an EXCLUDED FIELDS block naming it
 * as forbidden, so no copy may demand a hardcoded field name — "always fill
 * Preconditions" contradicts "never emit Preconditions".
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LLM_FEATURES, PROMPT_FEATURE_VARIABLES } from "../constants";
import { FALLBACK_PROMPTS } from "./fallback-prompts";

const REPO_ROOT = path.join(__dirname, "..", "..", "..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const TEXT_FIELD_GUIDANCE =
  "- For every text/textarea field listed above (and ONLY those):";

describe("test-case-generation prompt — excluded-field compatibility", () => {
  const fallback = FALLBACK_PROMPTS[LLM_FEATURES.TEST_CASE_GENERATION];

  it("scopes text-field guidance to the fields the prompt actually lists", () => {
    expect(fallback.systemPrompt).toContain(TEXT_FIELD_GUIDANCE);
    // No instruction may demand a specific field by name — any of them can be
    // deselected, and the exclusion block would then contradict it.
    expect(fallback.systemPrompt).not.toMatch(
      /(Preconditions|Post Conditions) should list|especially text fields like/
    );
  });

  it("keeps the seeded Default config in step with the fallback", () => {
    const seed = readSource("db/seedPromptConfig.ts");
    expect(seed).toContain(TEXT_FIELD_GUIDANCE);
    expect(seed).not.toContain("especially text fields like Description");
  });

  it("keeps the inline default in step with the fallback", () => {
    const inline = readSource("app/api/llm/generate-test-cases/shared.ts");
    expect(inline).toContain(TEXT_FIELD_GUIDANCE);
  });

  it("offers EXCLUDED_FIELDS_LIST in the prompt editor's variable picker", () => {
    // The picker reads this registry directly (not the DB `variables` column),
    // so admins on existing installs see the variable without a reseed.
    const names = PROMPT_FEATURE_VARIABLES[
      LLM_FEATURES.TEST_CASE_GENERATION
    ].map((v) => v.name);
    expect(names).toContain("EXCLUDED_FIELDS_LIST");
  });
});
