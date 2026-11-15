import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIELD_GUIDANCE_MAX_LENGTH } from "./constants";
import { DEFAULT_FIELD_GUIDANCE } from "./fieldGuidanceDefaults";

const migration = readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "migrations",
    "20261114120000_case_field_generation_guidance",
    "migration.sql"
  ),
  "utf8"
);

describe("default field guidance", () => {
  it.each(Object.entries(DEFAULT_FIELD_GUIDANCE))(
    "the migration gives existing fields the same %s guidance as the seed",
    (_name, text) => {
      expect(migration).toContain(`'${text.replace(/'/g, "''")}'`);
    }
  );

  it.each(Object.entries(DEFAULT_FIELD_GUIDANCE))(
    "%s guidance fits the column",
    (_name, text) => {
      expect(text.length).toBeLessThanOrEqual(FIELD_GUIDANCE_MAX_LENGTH);
    }
  );

  it("never overwrites guidance an administrator already wrote", () => {
    const updates = migration.split(/\bUPDATE\b/).slice(1);
    expect(updates).toHaveLength(4);
    for (const update of updates) {
      expect(update).toMatch(/"generationGuidance" IS NULL/);
    }
  });
});
