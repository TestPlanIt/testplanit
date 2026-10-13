import { describe, expect, it } from "vitest";
import { proseMirrorToMarkdown } from "../../packages/mcp-server/src/richText";
import { ensureTipTapJSON } from "./tiptapConversion";

/**
 * The MCP server returns rich text as Markdown so an agent can read a step,
 * change it and write it back. That only works if the Markdown it reads
 * converts back into the same document here: every sample below must survive
 * Markdown → document (this app's write path) → Markdown unchanged.
 */
const SAMPLES: Record<string, string> = {
  "plain paragraph": "Open the login page",
  "lone bold": "Open the **New leads** board",
  "lone inline code": "The board shows its `3` statuses",
  "mixed marks": "Click **Save**, then *wait* for `200` and ~~retry~~",
  link: "See [the docs](https://example.com/docs)",
  "hard breaks": "Step 1\nStep 2",
  paragraphs: "First\n\nSecond",
  "bullet list": "- one\n- two",
  "ordered list": "1. first\n2. second",
  heading: "## Setup",
  blockquote: "> Only on staging",
  "code block": "```\nnpm test\n```",
  rule: "Before\n\n---\n\nAfter",
  "list with marks": "- set to **10 minutes**\n- `retry` twice",
  "everything at once":
    "## Login\n\nOpen the **app**.\n\n1. enter `user`\n2. submit\n\n> expect a redirect",
};

describe("MCP Markdown round trip", () => {
  for (const [label, markdown] of Object.entries(SAMPLES)) {
    it(`keeps ${label}`, () => {
      expect(proseMirrorToMarkdown(ensureTipTapJSON(markdown))).toBe(markdown);
    });
  }
});
