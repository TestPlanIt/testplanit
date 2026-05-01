import { describe, expect, it } from "vitest";

import {
  redactValues,
  type ParameterSchemaEntry,
} from "./parameterRedaction";

/**
 * Schema fixture: one sensitive parameter (apiKey) and one non-sensitive
 * (username). Reused by most tests.
 */
const schemaWithSensitiveApiKey: ParameterSchemaEntry[] = [
  { name: "apiKey", sensitive: true },
  { name: "username", sensitive: false },
];

describe("redactValues", () => {
  it("returns values unchanged when viewerCanReadSensitive=true (sensitive flag set)", () => {
    const out = redactValues(
      { apiKey: "secret123", username: "alice" },
      schemaWithSensitiveApiKey,
      true,
    );

    expect(out).toEqual({ apiKey: "secret123", username: "alice" });
  });

  it("redacts sensitive entries when viewerCanReadSensitive=false", () => {
    const out = redactValues(
      { apiKey: "secret123", username: "alice" },
      schemaWithSensitiveApiKey,
      false,
    );

    expect(out).toEqual({ apiKey: "[REDACTED]", username: "alice" });
  });

  it("preserves non-sensitive plaintext alongside redacted sensitive values", () => {
    // Same as the redact test but documenting the contract: only the entries
    // whose schema row has sensitive=true are touched. Everything else
    // passes through verbatim regardless of value type.
    const out = redactValues(
      { apiKey: "secret123", username: "alice" },
      schemaWithSensitiveApiKey,
      false,
    );

    expect(out.username).toBe("alice");
    expect(out.apiKey).toBe("[REDACTED]");
  });

  it("passes unknown parameter names through unchanged when viewer lacks permission", () => {
    // Unknown name = not in paramSchema. Per RESEARCH.md Q5, the helper
    // falls through. Phase 3 schema-validation guards against unknowns
    // reaching audit metadata in the first place.
    const out = redactValues(
      { apiKey: "secret123", strangerKey: "whoknows" },
      schemaWithSensitiveApiKey,
      false,
    );

    expect(out).toEqual({
      apiKey: "[REDACTED]",
      strangerKey: "whoknows",
    });
  });

  it("returns an empty object for empty values input", () => {
    const out = redactValues({}, schemaWithSensitiveApiKey, false);

    expect(out).toEqual({});
  });

  it("passes all values through unchanged when paramSchema is empty (nothing flagged)", () => {
    const out = redactValues(
      { apiKey: "secret123", username: "alice" },
      [],
      false,
    );

    expect(out).toEqual({ apiKey: "secret123", username: "alice" });
  });

  it("redacts sensitive numeric values with the [REDACTED] string sentinel", () => {
    // Sentinel is a string regardless of original value type — matches the
    // existing audit-log convention in lib/services/auditLog.ts.
    const out = redactValues(
      { secretCount: 42, label: "ok" },
      [
        { name: "secretCount", sensitive: true },
        { name: "label", sensitive: false },
      ],
      false,
    );

    expect(out).toEqual({ secretCount: "[REDACTED]", label: "ok" });
  });

  it("does not mutate the input values object (returns a new object)", () => {
    // Defensive contract: the helper must not mutate its input. The same
    // input may be reused by callers (e.g., webhook payload + audit row
    // generated from the same iteration values).
    const input = { apiKey: "secret123", username: "alice" };
    const inputCopy = { ...input };

    redactValues(input, schemaWithSensitiveApiKey, false);

    expect(input).toEqual(inputCopy);
  });
});
