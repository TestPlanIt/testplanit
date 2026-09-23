import { describe, expect, it } from "vitest";
import type { ExecutionParam } from "./types";
import {
  configurationInputKeys,
  defaultParamValues,
  describeParamInputs,
  normalizeParamSchema,
  paramValuesFromInputs,
  parseConfigurationIds,
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
const config: ExecutionParam = {
  name: "CONFIG",
  label: "Configuration",
  type: "configuration",
  multiple: false,
  default: [12],
};
const configs: ExecutionParam = {
  name: "CONFIGS",
  label: "Configurations",
  type: "configuration",
  multiple: true,
  default: [12, 15],
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

describe("configuration parameters", () => {
  it("derives the three input keys from the parameter name", () => {
    expect(configurationInputKeys("CONFIG")).toEqual({
      id: "CONFIG_ID",
      name: "CONFIG",
      variants: "CONFIG_VARIANTS",
    });
  });

  it("accepts a well-formed declaration of either arity", () => {
    expect(validateParamSchema([config, configs])).toBeNull();
    expect(
      validateParamSchema([{ ...config, default: [] }, browser])
    ).toBeNull();
  });

  it.each<[string, ExecutionParam[], Record<string, string>, string]>([
    [
      "more than one default on a single-choice parameter",
      [{ ...config, default: [12, 15] }],
      {},
      "DEFAULT_NOT_SINGLE",
    ],
    [
      "a repeated default",
      [{ ...configs, default: [12, 12] }],
      {},
      "VALUES_DUPLICATE",
    ],
    [
      "a parameter named like a derived key",
      [config, { ...browser, name: "CONFIG_ID" }],
      {},
      "NAME_DUPLICATE",
    ],
    [
      "a static input named like a derived key",
      [config],
      { CONFIG_VARIANTS: "x" },
      "NAME_COLLIDES_WITH_INPUT",
    ],
  ])("rejects %s", (_label, params, statics, code) => {
    expect(validateParamSchema(params, statics)?.code).toBe(code);
  });

  it("counts a configuration parameter as three inputs against the cap", () => {
    const statics = Object.fromEntries(
      Array.from({ length: 17 }, (_, i) => [`S${i}`, "v"])
    );
    expect(validateParamSchema([config], statics)).toBeNull();
    expect(validateParamSchema([config], { ...statics, S17: "v" })?.code).toBe(
      "TOO_MANY_INPUTS"
    );
  });

  it("normalizes a stored declaration, trimming a single-choice default to one id", () => {
    expect(
      normalizeParamSchema([
        {
          name: "CONFIG",
          label: "Configuration",
          type: "configuration",
          default: [3, "x", 4],
        },
        {
          name: "CONFIGS",
          type: "configuration",
          multiple: true,
          default: [3, 4],
        },
      ])
    ).toEqual([
      {
        name: "CONFIG",
        label: "Configuration",
        type: "configuration",
        multiple: false,
        default: [3],
      },
      {
        name: "CONFIGS",
        label: "CONFIGS",
        type: "configuration",
        multiple: true,
        default: [3, 4],
      },
    ]);
  });

  it("parses stored ids leniently", () => {
    expect(parseConfigurationIds("12, 15,x,12,0")).toEqual([12, 15]);
    expect(parseConfigurationIds("")).toEqual([]);
    expect(parseConfigurationIds(undefined)).toEqual([]);
  });

  it("starts from the default ids, as strings, and sends them under the _ID key", () => {
    const values = defaultParamValues([config, configs]);
    expect(values).toEqual({ CONFIG: "12", CONFIGS: ["12", "15"] });
    expect(serializeParamValues([config, configs], values)).toEqual({
      CONFIG_ID: "12",
      CONFIGS_ID: "12,15",
    });
    expect(
      serializeParamValues([config, configs], { CONFIG: "", CONFIGS: [] })
    ).toEqual({ CONFIG_ID: "12", CONFIGS_ID: "12,15" });
  });

  it("seeds a retry from the stored _ID input, not the resolved name", () => {
    expect(
      paramValuesFromInputs([config, configs], {
        CONFIG: "Chrome on Windows",
        CONFIG_ID: "20",
        CONFIGS_ID: "21,22",
      })
    ).toEqual({ CONFIG: "20", CONFIGS: ["21", "22"] });
  });

  it("describes a resolved configuration by name and folds its derived keys in", () => {
    expect(
      describeParamInputs([config, browser], {
        CONFIG_ID: "12",
        CONFIG: "Chrome on Windows",
        CONFIG_VARIANTS: "Browser=Chrome,OS=Windows 11",
        BROWSER: "edge",
      })
    ).toEqual([
      {
        name: "CONFIG",
        label: "Configuration",
        values: ["Chrome on Windows"],
        declared: true,
      },
      { name: "BROWSER", label: "Browser", values: ["edge"], declared: true },
    ]);
    expect(
      describeParamInputs([config], { CONFIG_ID: "", CONFIG: "" })
    ).toEqual([
      { name: "CONFIG", label: "Configuration", values: [], declared: true },
    ]);
  });
});
