import { describe, expect, it } from "vitest";
import {
  buildDispatchInputs,
  describeInputError,
  MAX_CUSTOM_INPUT_KEYS,
  normalizeInputs,
  validateCustomInputs,
} from "./inputs";

describe("validateCustomInputs", () => {
  it("accepts a small map of plain keys", () => {
    expect(
      validateCustomInputs({ ENV: "staging", browser: "chrome" })
    ).toBeNull();
    expect(validateCustomInputs(undefined)).toBeNull();
  });

  it("rejects keys a CI provider would not accept", () => {
    expect(validateCustomInputs({ "bad key": "x" })).toEqual({
      code: "INVALID_KEY",
      key: "bad key",
    });
    expect(validateCustomInputs({ "1abc": "x" })).toEqual({
      code: "INVALID_KEY",
      key: "1abc",
    });
  });

  // The reserved prefix is how a target is prevented from lying about which
  // run it is executing.
  it("rejects reserved TESTPLANIT_* keys in any case", () => {
    expect(validateCustomInputs({ TESTPLANIT_RUN_ID: "9" })).toEqual({
      code: "RESERVED_KEY",
      key: "TESTPLANIT_RUN_ID",
    });
    expect(validateCustomInputs({ testplanit_url: "x" })).toEqual({
      code: "RESERVED_KEY",
      key: "testplanit_url",
    });
  });

  it("caps the number of keys and the size of values", () => {
    const many = Object.fromEntries(
      Array.from({ length: MAX_CUSTOM_INPUT_KEYS + 1 }, (_, i) => [
        `k${i}`,
        "v",
      ])
    );
    expect(validateCustomInputs(many)).toEqual({
      code: "TOO_MANY_KEYS",
      count: MAX_CUSTOM_INPUT_KEYS + 1,
    });
    expect(validateCustomInputs({ big: "x".repeat(1001) })).toEqual({
      code: "VALUE_TOO_LONG",
      key: "big",
    });
  });

  it("rejects non-objects", () => {
    expect(validateCustomInputs(["a"])).toEqual({ code: "NOT_AN_OBJECT" });
    expect(validateCustomInputs("x")).toEqual({ code: "NOT_AN_OBJECT" });
  });

  it("describes every error", () => {
    for (const err of [
      { code: "INVALID_KEY", key: "a b" } as const,
      { code: "RESERVED_KEY", key: "TESTPLANIT_X" } as const,
      { code: "VALUE_TOO_LONG", key: "v" } as const,
      { code: "TOO_MANY_KEYS", count: 99 } as const,
      { code: "TOO_LARGE", bytes: 99999 } as const,
      { code: "NOT_AN_OBJECT" } as const,
    ]) {
      expect(describeInputError(err).length).toBeGreaterThan(10);
    }
  });
});

describe("normalizeInputs / buildDispatchInputs", () => {
  it("stringifies values and drops non-objects", () => {
    expect(normalizeInputs({ a: 1, b: null, c: "x" })).toEqual({
      a: "1",
      b: "",
      c: "x",
    });
    expect(normalizeInputs(null)).toEqual({});
    expect(normalizeInputs([1])).toEqual({});
  });

  it("layers static < per-execution < reserved", () => {
    const merged = buildDispatchInputs(
      {
        runId: 42,
        executionId: 7,
        projectId: 3,
        appUrl: "https://tpi.example.com",
        planUrl:
          "https://tpi.example.com/api/test-runs/42/automation-plan?executionId=7",
      },
      { ENV: "staging", TESTPLANIT_RUN_ID: "999", browser: "firefox" },
      { browser: "chrome" }
    );
    expect(merged).toEqual({
      ENV: "staging",
      browser: "chrome",
      TESTPLANIT_RUN_ID: "42",
      TESTPLANIT_EXECUTION_ID: "7",
      TESTPLANIT_PROJECT_ID: "3",
      TESTPLANIT_URL: "https://tpi.example.com",
      TESTPLANIT_PLAN_URL:
        "https://tpi.example.com/api/test-runs/42/automation-plan?executionId=7",
    });
  });
});
