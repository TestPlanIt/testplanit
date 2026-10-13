import { describe, expect, it, vi } from "vitest";
import {
  formatConfigurationInputs,
  resolveConfigurationParams,
  type ConfigurationReader,
} from "./configurationParams";
import type { ExecutionParam } from "./types";

const rows = [
  {
    id: 12,
    name: "Chrome on Windows",
    variants: [
      { variant: { name: "Windows 11", category: { name: "OS" } } },
      { variant: { name: "Chrome", category: { name: "Browser" } } },
    ],
  },
  {
    id: 15,
    name: "Safari on macOS",
    variants: [
      { variant: { name: "Safari", category: { name: "Browser" } } },
      { variant: { name: "macOS", category: { name: "OS" } } },
    ],
  },
];

function reader(found = rows) {
  const findMany = vi.fn(async ({ where }) =>
    found.filter((r) => where.id.in.includes(r.id))
  );
  const db = { configurations: { findMany } } as unknown as ConfigurationReader;
  return { db, findMany };
}

const single: ExecutionParam = {
  name: "CONFIG",
  label: "Configuration",
  type: "configuration",
  multiple: false,
  default: [12],
};
const multi: ExecutionParam = {
  name: "CONFIGS",
  label: "Configurations",
  type: "configuration",
  multiple: true,
  default: [],
};

describe("formatConfigurationInputs", () => {
  it("writes the id, name and Category=Variant pairs; several configurations joined by ;", () => {
    expect(
      formatConfigurationInputs("CONFIGS", [
        {
          id: 12,
          name: "Chrome on Windows",
          variants: [
            ["Browser", "Chrome"],
            ["OS", "Windows 11"],
          ],
        },
        { id: 15, name: "Safari on macOS", variants: [["Browser", "Safari"]] },
      ])
    ).toEqual({
      CONFIGS_ID: "12,15",
      CONFIGS: "Chrome on Windows,Safari on macOS",
      CONFIGS_VARIANTS: "Browser=Chrome,OS=Windows 11;Browser=Safari",
    });
  });

  it("sends empty strings when nothing was chosen", () => {
    expect(formatConfigurationInputs("CONFIG", [])).toEqual({
      CONFIG_ID: "",
      CONFIG: "",
      CONFIG_VARIANTS: "",
    });
  });
});

describe("resolveConfigurationParams", () => {
  it("passes inputs through untouched when the target declares no configuration parameter", async () => {
    const { db, findMany } = reader();
    const result = await resolveConfigurationParams(db, 3, [], { X: "1" });
    expect(result).toEqual({ ok: true, inputs: { X: "1" } });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("expands the chosen ids into the three inputs, variants sorted by category, only for the project", async () => {
    const { db, findMany } = reader();
    const result = await resolveConfigurationParams(db, 3, [single, multi], {
      CONFIG_ID: "12",
      CONFIGS_ID: "15,12",
      // A caller cannot pre-fill the derived keys.
      CONFIG: "spoofed",
      OTHER: "kept",
    });
    expect(result).toEqual({
      ok: true,
      inputs: {
        OTHER: "kept",
        CONFIG_ID: "12",
        CONFIG: "Chrome on Windows",
        CONFIG_VARIANTS: "Browser=Chrome,OS=Windows 11",
        CONFIGS_ID: "15,12",
        CONFIGS: "Safari on macOS,Chrome on Windows",
        CONFIGS_VARIANTS:
          "Browser=Safari,OS=macOS;Browser=Chrome,OS=Windows 11",
      },
    });
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      id: { in: [12, 15] },
      isDeleted: false,
      isEnabled: true,
      projects: { some: { projectId: 3 } },
    });
  });

  it("falls back to the default when the caller left the parameter out", async () => {
    const { db } = reader();
    const result = await resolveConfigurationParams(db, 3, [single], {});
    expect(result.ok && result.inputs.CONFIG).toBe("Chrome on Windows");
  });

  it("refuses an id that is not assigned to the project", async () => {
    const { db } = reader([rows[0]]);
    const result = await resolveConfigurationParams(db, 3, [multi], {
      CONFIGS_ID: "12,99",
    });
    expect(result).toEqual({
      ok: false,
      error: "Configuration 99 is not assigned to this project",
    });
  });

  it("refuses several ids on a single-choice parameter before reading anything", async () => {
    const { db, findMany } = reader();
    const result = await resolveConfigurationParams(db, 3, [single], {
      CONFIG_ID: "12,15",
    });
    expect(result.ok).toBe(false);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("sends empty strings when nothing was chosen and there is no default", async () => {
    const { db, findMany } = reader();
    const result = await resolveConfigurationParams(db, 3, [multi], {
      CONFIGS_ID: "",
    });
    expect(result).toEqual({
      ok: true,
      inputs: { CONFIGS_ID: "", CONFIGS: "", CONFIGS_VARIANTS: "" },
    });
    expect(findMany).not.toHaveBeenCalled();
  });
});
