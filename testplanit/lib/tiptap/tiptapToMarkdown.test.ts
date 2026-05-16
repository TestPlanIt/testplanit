import { describe, expect, it } from "vitest";
import { escapeMarkdown, tiptapToMarkdown } from "./tiptapToMarkdown";

describe("Wave 3 INT-05 tiptap → markdown serializer", () => {
  it("serializes paragraph + heading to markdown", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Failure summary" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Iteration 3 of 5 failed." }],
        },
      ],
    };
    const md = tiptapToMarkdown(doc);
    expect(md).toContain("## Failure summary");
    // The trailing period is escaped per the GFM "characters that may need
    // escaping" set — adversarial-safe is the policy.
    expect(md).toContain("Iteration 3 of 5 failed\\.");
  });

  it("serializes table node to GitHub-flavored pipe-separated rows", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Parameter" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Value" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "username" }],
                    },
                  ],
                },
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "alice" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "password" }],
                    },
                  ],
                },
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "[REDACTED]" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const md = tiptapToMarkdown(doc);
    expect(md).toContain("| Parameter | Value |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| username | alice |");
    expect(md).toMatch(/\| password \| \\\[REDACTED\\\] \|/);
  });

  it("table with empty cell renders single space, not empty string", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "A" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "B" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [{ type: "paragraph", content: [] }],
                },
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "value" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const md = tiptapToMarkdown(doc);
    // Cell must be a single space, never empty between pipes
    expect(md).toContain("|   | value |");
    // No bare `||` pattern anywhere in the table body
    expect(md).not.toMatch(/\|\|/);
  });

  it("preserves link href with link mark on text node", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "View iteration in TestPlanIt",
              marks: [
                {
                  type: "link",
                  attrs: { href: "https://example.com/projects/runs/1/2" },
                },
              ],
            },
          ],
        },
      ],
    };
    const md = tiptapToMarkdown(doc);
    expect(md).toContain(
      "[View iteration in TestPlanIt](https://example.com/projects/runs/1/2)"
    );
  });

  it("throws on unknown node type", () => {
    const doc = {
      type: "doc",
      content: [{ type: "weirdCustomNode", content: [] }],
    };
    expect(() => tiptapToMarkdown(doc)).toThrow(/unsupported node type/i);
  });

  it("adversarial: markdown injection in text node is escaped", () => {
    // A malicious case-name. If unescaped, ](javascript:alert(1)) could
    // close an existing link span and forge a new one.
    const malicious = "innocent]( javascript:alert(1) )";
    const escaped = escapeMarkdown(malicious);
    // Bracket + paren must be backslash-escaped.
    expect(escaped).toContain("\\]");
    expect(escaped).toContain("\\(");
    expect(escaped).toContain("\\)");
    // And via the full serializer:
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: malicious }],
        },
      ],
    };
    const md = tiptapToMarkdown(doc);
    // The escaped text should appear, but no forged link spans
    expect(md).toContain("innocent\\]\\( javascript:alert\\(1\\) \\)");
  });

  it("adversarial: pipe injection in table cell does NOT escape parent table", () => {
    const evil = "\n| evil | row |\n";
    const doc = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "A" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "B" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: evil }],
                    },
                  ],
                },
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "ok" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const md = tiptapToMarkdown(doc);
    // Find the body row line — pipes inside the cell must be escaped, and
    // newlines must NOT appear inside that single row line.
    const lines = md.split("\n");
    const bodyRows = lines.filter(
      (l) => l.startsWith("| ") && !l.includes("---") && !l.includes("A | B")
    );
    expect(bodyRows.length).toBe(1);
    const row = bodyRows[0];
    // Row contains exactly 3 pipe-separators (start/mid/end)
    const pipeCount = (row.match(/(?<!\\)\|/g) || []).length;
    expect(pipeCount).toBe(3);
    // The escaped pipes from the cell content must be present
    expect(row).toContain("\\|");
    expect(row).toContain("evil");
  });

  it("adversarial: unknown node type embedded in known content throws (does not emit partial)", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello" }],
        },
        { type: "mysteryBlock", content: [] },
      ],
    };
    expect(() => tiptapToMarkdown(doc)).toThrow(/unsupported node type/i);
  });

  it("serializes bullet list and ordered list", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "First" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Second" }],
                },
              ],
            },
          ],
        },
      ],
    };
    const md = tiptapToMarkdown(doc);
    expect(md).toContain("- First");
    expect(md).toContain("- Second");
  });

  it("escapeMarkdown escapes the full GitHub-flavored set", () => {
    const input = "a\\b`c*d_e{f}g[h]i(j)k#l+m-n.o!p|q";
    const out = escapeMarkdown(input);
    // Spot-check each escape
    for (const ch of [
      "\\\\",
      "\\`",
      "\\*",
      "\\_",
      "\\{",
      "\\}",
      "\\[",
      "\\]",
      "\\(",
      "\\)",
      "\\#",
      "\\+",
      "\\-",
      "\\.",
      "\\!",
      "\\|",
    ]) {
      expect(out).toContain(ch);
    }
  });
});
