import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { buildSpec, renderSpec } from "./generate-openapi";

describe("generate-openapi", () => {
  it("checked-in zenstack-openapi.json matches the generator output", () => {
    const specPath = join(
      __dirname,
      "..",
      "lib",
      "openapi",
      "zenstack-openapi.json"
    );
    const onDisk = readFileSync(specPath, "utf-8");
    // Boolean compare on purpose: a 27MB string diff would drown the report.
    expect(
      onDisk === renderSpec(),
      "lib/openapi/zenstack-openapi.json is stale — run `pnpm generate`"
    ).toBe(true);
  });

  it("documents every model with paths, tag, and core schemas", () => {
    const spec = buildSpec();
    const tagNames = new Set(spec.tags.map((t: { name: string }) => t.name));
    for (const tag of [
      "repositoryCaseIssue",
      "repositoryCaseTag",
      "milestoneIssue",
    ]) {
      expect(tagNames.has(tag), `missing tag ${tag}`).toBe(true);
      expect(spec.paths[`/api/model/${tag}/findMany`]).toBeDefined();
    }
    const s = spec.components.schemas;
    // The relations that replaced the pre-v3 implicit m2m fields.
    expect(Object.keys(s.IssueSelect.properties)).toContain("caseIssues");
    expect(Object.keys(s.RepositoryCasesSelect.properties)).toContain(
      "caseTags"
    );
    expect(Object.keys(s.IssueSelect.properties)).not.toContain(
      "repositoryCases"
    );
    expect(Object.keys(s.RepositoryCasesWhereInput.properties)).not.toContain(
      "issues"
    );
  });
});
