import { describe, expect, it, vi } from "vitest";
import { translateServerError } from "./translateServerError";

describe("translateServerError", () => {
  it("returns translated string when errorCode is present and key resolves", () => {
    const t = vi.fn(() => "Translated message");
    const result = translateServerError(
      t,
      { errorCode: "errors.foo", error: "English fallback" },
      "Generic"
    );
    expect(result).toBe("Translated message");
    expect(t).toHaveBeenCalledWith("errors.foo");
  });

  it("falls back to legacy `error` when next-intl returns the raw key", () => {
    // next-intl returns the key string when no translation exists.
    const t = vi.fn((key: string) => key);
    const result = translateServerError(
      t,
      { errorCode: "errors.missing", error: "English fallback" },
      "Generic"
    );
    expect(result).toBe("English fallback");
  });

  it("falls back to caller-supplied fallback when both lookup and `error` are missing", () => {
    const t = vi.fn((key: string) => key);
    const result = translateServerError(
      t,
      { errorCode: "errors.missing" },
      "Generic"
    );
    expect(result).toBe("Generic");
  });

  it("returns `error` when no errorCode is present (legacy server response)", () => {
    const t = vi.fn();
    const result = translateServerError(
      t,
      { error: "Server told us something" },
      "Generic"
    );
    expect(result).toBe("Server told us something");
    expect(t).not.toHaveBeenCalled();
  });

  it("returns fallback when result is null/undefined", () => {
    const t = vi.fn();
    expect(translateServerError(t, null, "Generic")).toBe("Generic");
    expect(translateServerError(t, undefined, "Generic")).toBe("Generic");
    expect(t).not.toHaveBeenCalled();
  });

  it("returns empty string when result is null and no fallback supplied", () => {
    const t = vi.fn();
    expect(translateServerError(t, null)).toBe("");
  });

  it("recovers when the translator throws on a missing key", () => {
    const t = vi.fn(() => {
      throw new Error("MISSING_MESSAGE");
    });
    const result = translateServerError(
      t,
      { errorCode: "errors.unknown", error: "Legacy English" },
      "Generic"
    );
    expect(result).toBe("Legacy English");
  });

  it("does not call translator when errorCode is empty string", () => {
    const t = vi.fn();
    const result = translateServerError(
      t,
      { errorCode: "", error: "English" },
      "Generic"
    );
    expect(result).toBe("English");
    expect(t).not.toHaveBeenCalled();
  });
});
