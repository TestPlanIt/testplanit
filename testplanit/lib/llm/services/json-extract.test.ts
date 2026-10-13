import { describe, expect, it } from "vitest";
import { extractJsonObject, stripCodeFence } from "./json-extract";

describe("stripCodeFence", () => {
  it("returns an unfenced object unchanged", () => {
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
  });

  it("strips a ```json fence", () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("strips a fence opener with no closer", () => {
    expect(stripCodeFence('```json\n{"a":1}')).toBe('{"a":1}');
  });

  it("drops prose before and after the object", () => {
    expect(
      stripCodeFence(
        'Here is the JSON:\n{"a":{"b":2}}\nLet me know if that helps.'
      )
    ).toBe('{"a":{"b":2}}');
  });

  it("falls back to the trimmed input when no brace pair exists", () => {
    expect(stripCodeFence("  nothing here \n")).toBe("nothing here");
    expect(stripCodeFence("}{")).toBe("}{");
  });
});

describe("extractJsonObject", () => {
  it("returns the object span for fenced and unfenced input", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
    expect(extractJsonObject('prose {"a":1} prose')).toBe('{"a":1}');
  });

  it("returns null when no object is present", () => {
    expect(extractJsonObject("")).toBeNull();
    expect(extractJsonObject("no json at all")).toBeNull();
    expect(extractJsonObject("{")).toBeNull();
    expect(extractJsonObject("}{")).toBeNull();
    expect(extractJsonObject("[1,2,3]")).toBeNull();
  });
});
