import { describe, expect, it } from "vitest";

import {
  createParameterMentionExtension,
  type ParameterChipMeta,
} from "~/lib/tiptap/parameterMentionExtension";

const PARAMS: ParameterChipMeta[] = [
  { id: 1, name: "username", type: "STRING", defaultValue: "alice" },
  { id: 2, name: "userAge", type: "INTEGER", defaultValue: "30" },
  { id: 3, name: "env", type: "SELECT", defaultValue: null },
];

describe("createParameterMentionExtension", () => {
  it("uses the parameterMention extension name (not 'mention')", () => {
    const extension = createParameterMentionExtension(PARAMS);
    expect(extension.name).toBe("parameterMention");
  });

  it("declares paramId and paramType attributes via addAttributes()", () => {
    const extension = createParameterMentionExtension(PARAMS);
    const attrs = (
      extension.config.addAttributes as
        | (() => Record<string, unknown>)
        | undefined
    )?.call({ parent: () => ({}) });
    expect(attrs).toBeDefined();
    expect(attrs).toHaveProperty("paramId");
    expect(attrs).toHaveProperty("paramType");
  });

  it("renderHTML returns plain-DOM tuple starting with 'span' and ending with '@<name>'", () => {
    const extension = createParameterMentionExtension(PARAMS);
    const renderHTML = extension.config.renderHTML as unknown as (props: {
      node: { attrs: Record<string, unknown> };
      HTMLAttributes: Record<string, unknown>;
    }) => unknown[];
    const out = renderHTML({
      node: {
        attrs: {
          id: "username",
          label: "username",
          paramId: 1,
          paramType: "STRING",
        },
      },
      HTMLAttributes: {},
    });
    expect(Array.isArray(out)).toBe(true);
    expect(out[0]).toBe("span");
    // Chip body is now structured: outer span wraps a `parameter-ref-chip-text`
    // span carrying the visible label/value. When a non-sensitive parameter has
    // a value, the chip substitutes it inline (e.g. `@username: alice`).
    const textNode = out
      .slice(2)
      .find(
        (child): child is unknown[] =>
          Array.isArray(child) &&
          (child[1] as Record<string, unknown> | undefined)?.class ===
            "parameter-ref-chip-text"
      );
    expect(textNode).toBeDefined();
    expect(textNode![textNode!.length - 1]).toBe("@username: alice");
  });

  it("renderHTML attrs include the chip CSS class and data attributes", () => {
    const extension = createParameterMentionExtension(PARAMS);
    const renderHTML = extension.config.renderHTML as unknown as (props: {
      node: { attrs: Record<string, unknown> };
      HTMLAttributes: Record<string, unknown>;
    }) => unknown[];
    const out = renderHTML({
      node: {
        attrs: {
          id: "username",
          label: "username",
          paramId: 1,
          paramType: "STRING",
        },
      },
      HTMLAttributes: {},
    }) as [string, Record<string, unknown>, string];
    const attrs = out[1];
    expect(attrs.class).toContain("parameter-ref-chip");
    expect(attrs["data-type"]).toBe("parameterMention");
    expect(attrs["data-id"]).toBe("username");
    expect(attrs["data-label"]).toBe("username");
    expect(attrs.contenteditable).toBe("false");
  });

  it("marks undeclared chips with data-undeclared='true'", () => {
    const extension = createParameterMentionExtension(PARAMS);
    const renderHTML = extension.config.renderHTML as unknown as (props: {
      node: { attrs: Record<string, unknown> };
      HTMLAttributes: Record<string, unknown>;
    }) => unknown[];

    const declared = renderHTML({
      node: {
        attrs: {
          id: "username",
          label: "username",
          paramId: 1,
          paramType: "STRING",
        },
      },
      HTMLAttributes: {},
    }) as [string, Record<string, unknown>, string];
    expect(declared[1]["data-undeclared"]).toBe("false");

    const undeclared = renderHTML({
      node: {
        attrs: {
          id: "missing",
          label: "missing",
          paramId: null,
          paramType: null,
        },
      },
      HTMLAttributes: {},
    }) as [string, Record<string, unknown>, string];
    expect(undeclared[1]["data-undeclared"]).toBe("true");
  });

  it("suggestion.items filters case-insensitively by name prefix and slices to 8", async () => {
    const extension = createParameterMentionExtension(PARAMS);
    const items = (extension.options.suggestion as {
      items: (args: { query: string }) => Promise<ParameterChipMeta[]> | ParameterChipMeta[];
    }).items;

    const result = await items({ query: "us" });
    expect(result.map((p) => p.name)).toEqual(["username", "userAge"]);

    const empty = await items({ query: "zz" });
    expect(empty).toEqual([]);

    // Slicing to 8: build a fake parameter list of 12.
    const big: ParameterChipMeta[] = Array.from({ length: 12 }, (_, i) => ({
      id: i + 100,
      name: `param${i}`,
      type: "STRING",
      defaultValue: null,
    }));
    const ext2 = createParameterMentionExtension(big);
    const items2 = (ext2.options.suggestion as {
      items: (args: { query: string }) => Promise<ParameterChipMeta[]> | ParameterChipMeta[];
    }).items;
    const sliced = await items2({ query: "param" });
    expect(sliced).toHaveLength(8);
  });

  it("works with an empty parameters list (PARAM-07: no crash)", async () => {
    const extension = createParameterMentionExtension([]);
    expect(extension.name).toBe("parameterMention");
    const items = (extension.options.suggestion as {
      items: (args: { query: string }) => Promise<ParameterChipMeta[]> | ParameterChipMeta[];
    }).items;
    const result = await items({ query: "anything" });
    expect(result).toEqual([]);
  });
});
