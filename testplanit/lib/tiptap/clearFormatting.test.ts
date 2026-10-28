// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { Color } from "@tiptap/extension-color";
import { Link } from "@tiptap/extension-link";
import { TextStyle } from "@tiptap/extension-text-style";
import { Underline } from "@tiptap/extension-underline";
import { StarterKit } from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import { clearFormatting } from "./clearFormatting";

let editor: Editor | undefined;

/** Mirrors the mark/node set the rich-text toolbar is mounted with. */
const makeEditor = (content: string) => {
  editor = new Editor({
    extensions: [
      StarterKit.configure({ link: false, underline: false }),
      Underline,
      Link.configure({ openOnClick: false }),
      Color,
      TextStyle,
    ],
    content,
  });
  return editor;
};

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

describe("clearFormatting", () => {
  it("strips inline marks from the selection", () => {
    const e = makeEditor(
      "<p><strong>bold</strong> <em>italic</em> <u>under</u> <s>struck</s> <code>code</code></p>"
    );
    e.commands.selectAll();

    clearFormatting(e);

    expect(e.getHTML()).toBe("<p>bold italic under struck code</p>");
  });

  it("strips text colour applied through textStyle", () => {
    const e = makeEditor('<p><span style="color: #ff0000">red</span></p>');
    e.commands.selectAll();

    clearFormatting(e);

    expect(e.getHTML()).toBe("<p>red</p>");
  });

  it("collapses headings and code blocks to paragraphs", () => {
    // Trailing paragraph so StarterKit's trailing-node plugin does not append
    // one of its own and muddy the assertion.
    const e = makeEditor(
      "<h2>Title</h2><pre><code>snippet</code></pre><p>tail</p>"
    );
    e.commands.selectAll();

    clearFormatting(e);

    expect(e.getHTML()).toBe("<p>Title</p><p>snippet</p><p>tail</p>");
  });

  it("unwraps lists and blockquotes", () => {
    const e = makeEditor(
      "<ul><li><p><strong>one</strong></p></li><li><p>two</p></li></ul><blockquote><p>quoted</p></blockquote><p>tail</p>"
    );
    e.commands.selectAll();

    clearFormatting(e);

    expect(e.getHTML()).toBe("<p>one</p><p>two</p><p>quoted</p><p>tail</p>");
  });

  it("leaves text outside the selection formatted", () => {
    const e = makeEditor(
      "<p><strong>first</strong></p><p><strong>second</strong></p>"
    );
    // Select the first paragraph's text only.
    e.commands.setTextSelection({ from: 1, to: 6 });

    clearFormatting(e);

    expect(e.getHTML()).toBe("<p>first</p><p><strong>second</strong></p>");
  });

  it("clears the enclosing block when the cursor is collapsed", () => {
    const e = makeEditor("<h3><strong>heading</strong></h3><p>after</p>");
    // Collapsed cursor inside the heading text.
    e.commands.setTextSelection(4);
    expect(e.state.selection.empty).toBe(true);

    clearFormatting(e);

    expect(e.getHTML()).toBe("<p>heading</p><p>after</p>");
  });
});
