import { describe, it, expect } from "vitest";
import { cn, randomElement } from "./index";

describe("cn (className utility)", () => {
  it("should merge simple class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("should handle conditional classes", () => {
    expect(cn("base", true && "active")).toBe("base active");
    expect(cn("base", false && "active")).toBe("base");
  });

  it("should merge tailwind classes correctly", () => {
    // twMerge should handle conflicting tailwind classes
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("should handle undefined and null values", () => {
    expect(cn("foo", undefined, "bar", null)).toBe("foo bar");
  });

  it("should handle arrays of classes", () => {
    expect(cn(["foo", "bar"])).toBe("foo bar");
  });

  it("should handle objects with boolean values", () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe("foo baz");
  });

  it("should handle empty input", () => {
    expect(cn()).toBe("");
  });

  it("should handle mixed inputs", () => {
    expect(cn("base", ["arr1", "arr2"], { conditional: true })).toBe(
      "base arr1 arr2 conditional"
    );
  });
});

describe("randomElement", () => {
  it("should return an element from the array", () => {
    const arr = [1, 2, 3, 4, 5];
    const result = randomElement(arr);
    expect(arr).toContain(result);
  });

  it("should return undefined for empty array", () => {
    const result = randomElement([]);
    expect(result).toBeUndefined();
  });

  it("should return the only element for single-element array", () => {
    const result = randomElement(["only"]);
    expect(result).toBe("only");
  });

  it("should work with different types", () => {
    const stringArr = ["a", "b", "c"];
    const stringResult = randomElement(stringArr);
    expect(typeof stringResult).toBe("string");

    const objArr = [{ id: 1 }, { id: 2 }];
    const objResult = randomElement(objArr);
    expect(objResult).toHaveProperty("id");
  });

  it("should throw for undefined/null input (no defensive check)", () => {
    // The function doesn't check for null/undefined, so it will throw
    expect(() => randomElement(undefined as any)).toThrow();
    expect(() => randomElement(null as any)).toThrow();
  });
});
