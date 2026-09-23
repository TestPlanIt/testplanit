import { describe, expect, it } from "vitest";
import type { ExecutionParam } from "./types";
import {
  defaultParamValues,
  describeParamInputs,
  normalizeParamSchema,
  paramValuesFromInputs,
  serializeParamValues,
  validateParamSchema,
} from "./params";

const browser: ExecutionParam = {
  name: "BROWSER",
  label: "Browser",
  type: "select",
  values: ["chrome", "edge", "firefox", "safari"],
  default: "chrome",
};
const tags: ExecutionParam = {
  name: "TAGS",
  label: "Tags",
  type: "multiselect",
  values: ["smoke", "regression", "slow"],
  default: ["smoke"],
};
const note: ExecutionParam = {
  name: "NOTE",
  label: "Note",
  type: "text",
  default: "nightly",
};

describe("validateParamSchema", () => {
  it("accepts a well-formed declaration of each kind", () => {
    expect(validateParamSchema([browser, tags, note])).toBeNull();
    expect(
      validateParamSchema([{ name: "FREE", label: "Free", type: "text" }])
    ).toBeNull();
  });

  it.each<[string, ExecutionParam[], string]>([
    ["a duplicate name", [browser, { ...browser }], "NAME_DUPLICATE"],
    [
      "a reserved name",
      [{ ...browser, name: "TESTPLANIT_URL" }],
      "NAME_RESERVED",
    ],
    [
      "a reserved name in any case",
      [{ ...browser, name: "testplanit_extra" }],
      "NAME_RESERVED",
    ],
    [
      "a name with a dash",
      [{ ...browser, name: "my-browser" }],
      "NAME_INVALID",
    ],
    [
      "a name starting with a digit",
      [{ ...browser, name: "1x" }],
      "NAME_INVALID",
    ],
    ["a blank label", [{ ...browser, label: "  " }], "LABEL_REQUIRED"],
    ["no values", [{ ...browser, values: [] }], "VALUES_REQUIRED"],
    [
      "a repeated value",
      [{ ...browser, values: ["chrome", "chrome"] }],
      "VALUES_DUPLICATE",
    ],
    [
      "an empty value",
      [{ ...browser, values: ["chrome", ""] }],
      "VALUE_TOO_LONG",
    ],
    [
      "a select default outside the values",
      [{ ...browser, default: "opera" }],
      "DEFAULT_NOT_IN_VALUES",
    ],
    [
      "a multiselect default outside the values",
      [{ ...tags, default: ["smoke", "opera"] }],
      "DEFAULT_NOT_IN_VALUES",
    ],
    [
      "a multiselect value containing the separator",
      [{ ...tags, values: ["a,b"], default: [] }],
      "VALUE_HAS_SEPARATOR",
    ],
  ])("rejects %s", (_label, params, code) => {
    expect(validateParamSchema(params)?.code).toBe(code);
  });

  it("allows a comma inside a single-choice value (nothing splits it)", () => {
    expect(
      validateParamSchema([
        { ...browser, values: ["a,b", "c"], default: "a,b" },
      ])
    ).toBeNull();
  });

  it("refuses a name that a static input already uses", () => {
    expect(validateParamSchema([browser], { BROWSER: "chrome" })).toEqual({
      code: "NAME_COLLIDES_WITH_INPUT",
      name: "BROWSER",
    });
  });

  it("counts static inputs and parameters against the shared cap", () => {
    const statics = Object.fromEntries(
      Array.from({ length: 19 }, (_, i) => [`S${i}`, "x"])
    );
    expect(validateParamSchema([browser], statics)).toBeNull();
    expect(validateParamSchema([browser, note], statics)).toEqual({
      code: "TOO_MANY_INPUTS",
      count: 21,
    });
  });
});

describe("normalizeParamSchema", () => {
  it("reads stored rows and drops entries that do not fit", () => {
    expect(
      normalizeParamSchema([
        browser,
        { name: "X", type: "select" },
        { name: "Y", type: "bogus", values: [] },
        "junk",
        { name: "Z", type: "multiselect", values: ["a", 1], default: "a" },
        { name: "T", type: "text" },
      ])
    ).toEqual([
      browser,
      {
        name: "Z",
        label: "Z",
        type: "multiselect",
        values: ["a"],
        default: [],
      },
      { name: "T", label: "T", type: "text" },
    ]);
    expect(normalizeParamSchema(null)).toEqual([]);
    expect(normalizeParamSchema({})).toEqual([]);
  });
});

describe("dialog values", () => {
  it("starts from each parameter's default", () => {
    expect(defaultParamValues([browser, tags, note])).toEqual({
      BROWSER: "chrome",
      TAGS: ["smoke"],
      NOTE: "nightly",
    });
    expect(
      defaultParamValues([{ name: "F", label: "F", type: "text" }])
    ).toEqual({ F: "" });
  });

  it("seeds a retry from the stored inputs, ignoring choices the target no longer offers", () => {
    expect(
      paramValuesFromInputs([browser, tags, note], {
        BROWSER: "opera",
        TAGS: "regression, slow ,gone",
        NOTE: "rerun",
        TESTPLANIT_RUN_ID: "42",
      })
    ).toEqual({
      BROWSER: "chrome",
      TAGS: ["regression", "slow"],
      NOTE: "rerun",
    });
  });

  it("serializes every declared parameter to a string, joining multiselects with commas", () => {
    expect(
      serializeParamValues([browser, tags, note], {
        BROWSER: "edge",
        TAGS: ["smoke", "regression"],
        NOTE: "",
      })
    ).toEqual({ BROWSER: "edge", TAGS: "smoke,regression", NOTE: "" });
    // A parameter the dialog never touched still goes out with its default.
    expect(serializeParamValues([browser, tags], {})).toEqual({
      BROWSER: "chrome",
      TAGS: "smoke",
    });
  });
});

describe("describeParamInputs", () => {
  it("labels declared parameters in schema order and splits multiselects", () => {
    expect(
      describeParamInputs([browser, tags], {
        TAGS: "smoke,regression",
        BROWSER: "edge",
      })
    ).toEqual([
      { name: "BROWSER", label: "Browser", values: ["edge"], declared: true },
      {
        name: "TAGS",
        label: "Tags",
        values: ["smoke", "regression"],
        declared: true,
      },
    ]);
  });

  it("appends undeclared inputs under their key and skips unsent parameters", () => {
    expect(
      describeParamInputs([browser, tags], { BROWSER: "edge", SUITE: "api" })
    ).toEqual([
      { name: "BROWSER", label: "Browser", values: ["edge"], declared: true },
      { name: "SUITE", label: "SUITE", values: ["api"], declared: false },
    ]);
  });

  it("drops the reserved TESTPLANIT_* identifiers the dispatcher stores", () => {
    expect(
      describeParamInputs([browser], {
        TESTPLANIT_RUN_ID: "60",
        TESTPLANIT_PLAN_URL: "http://localhost/plan",
        BROWSER: "edge",
        FAIL_EVERY: "3",
      })
    ).toEqual([
      { name: "BROWSER", label: "Browser", values: ["edge"], declared: true },
      {
        name: "FAIL_EVERY",
        label: "FAIL_EVERY",
        values: ["3"],
        declared: false,
      },
    ]);
  });

  it("keeps an empty text value and yields nothing for no inputs", () => {
    const env = { name: "ENV", label: "Environment", type: "text" } as const;
    expect(describeParamInputs([env], { ENV: "" })).toEqual([
      { name: "ENV", label: "Environment", values: [""], declared: true },
    ]);
    expect(describeParamInputs([browser], null)).toEqual([]);
    expect(describeParamInputs([browser], "junk")).toEqual([]);
  });
});
