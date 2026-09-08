import { describe, expect, it } from "vitest";
import { extractCompleteJsonFields } from "./partialJson";

describe("extractCompleteJsonFields", () => {
  it("reads the finished top-level keys of an unterminated object", () => {
    const { complete } = extractCompleteJsonFields(
      '{"id": "tc_1", "name": "Login works", "tags": ["Smoke"], "fieldValues": {"Description": "partial'
    );

    expect(complete.id).toBe("tc_1");
    expect(complete.name).toBe("Login works");
    expect(complete.tags).toEqual(["Smoke"]);
    expect(complete.fieldValues).toBeUndefined();
  });

  it("reports the key still arriving so callers can read into it", () => {
    const result = extractCompleteJsonFields(
      '{"name": "x", "fieldValues": {"Description": "done", "Steps": [{"step": "a"'
    );

    expect(result.partialKey).toBe("fieldValues");
    const nested = extractCompleteJsonFields(result.partialValue!);
    expect(nested.complete.Description).toBe("done");
    expect(nested.complete.Steps).toBeUndefined();
  });

  it("does not read keys nested inside a value as top-level fields", () => {
    const { complete } = extractCompleteJsonFields(
      '{"Description": "d", "Steps": [{"step": "one", "expectedResult": "r1"}, {"step": "two", "expectedResult": "r2"}]}'
    );

    expect(Object.keys(complete)).toEqual(["Description", "Steps"]);
    expect(complete.Steps).toHaveLength(2);
    expect(complete.step).toBeUndefined();
    expect(complete.expectedResult).toBeUndefined();
  });

  it("handles escaped quotes and braces inside strings", () => {
    const { complete } = extractCompleteJsonFields(
      '{"name": "He said \\"go\\" {now}", "n": 12, "done": true}'
    );

    expect(complete.name).toBe('He said "go" {now}');
    expect(complete.n).toBe(12);
    expect(complete.done).toBe(true);
  });

  it("withholds a number that may still be growing", () => {
    expect(extractCompleteJsonFields('{"n": 12').complete.n).toBeUndefined();
    expect(extractCompleteJsonFields('{"n": 12,').complete.n).toBe(12);
  });

  it("returns nothing for text without an object", () => {
    expect(extractCompleteJsonFields("no json here").complete).toEqual({});
  });
});
