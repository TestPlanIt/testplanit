// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { Link } from "@tiptap/extension-link";
import { Underline } from "@tiptap/extension-underline";
import { StarterKit } from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "~/app/extensions/Table";
import { readToolbarState } from "./toolbarState";

let editor: Editor | undefined;

const makeEditor = (content: string) => {
  editor = new Editor({
    extensions: [
      StarterKit.configure({ link: false, underline: false }),
      Underline,
      Link.configure({ openOnClick: false }),
      Table,
      TableRow,
      TableCell,
      TableHeader,
    ],
    content,
  });
  return editor;
};

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

/** Selects the first occurrence of `text`, then reads the toolbar flags. */
const stateAt = (e: Editor, text: string) => {
  let from = -1;
  e.state.doc.descendants((node, pos) => {
    if (from === -1 && node.isText && node.text?.includes(text)) {
      from = pos + node.text.indexOf(text);
    }
  });
  if (from === -1) throw new Error(`"${text}" not found in the document`);
  e.commands.setTextSelection({ from, to: from + text.length });
  return readToolbarState(e);
};

describe("readToolbarState", () => {
  it("tracks the selection moving between formatted and plain text", () => {
    const e = makeEditor("<p><strong>bold</strong> plain</p>");

    expect(stateAt(e, "bold").isBold).toBe(true);
    expect(stateAt(e, "plain").isBold).toBe(false);
  });

  it("reports the active block type", () => {
    const e = makeEditor(
      "<h2>Title</h2><p>body</p><ul><li><p>item</p></li></ul>"
    );

    expect(stateAt(e, "Title")).toMatchObject({
      isHeading2: true,
      isHeading1: false,
      isParagraph: false,
      isBulletList: false,
    });
    expect(stateAt(e, "body")).toMatchObject({
      isHeading2: false,
      isParagraph: true,
      isBulletList: false,
    });
    expect(stateAt(e, "item")).toMatchObject({
      isBulletList: true,
      isHeading2: false,
    });
  });

  it("tracks inline marks and links independently", () => {
    const e = makeEditor(
      '<p><em>i</em><u>u</u><s>s</s><code>c</code><a href="https://example.com">l</a></p>'
    );

    expect(stateAt(e, "i").isItalic).toBe(true);
    expect(stateAt(e, "u").isUnderline).toBe(true);
    expect(stateAt(e, "s").isStrike).toBe(true);
    expect(stateAt(e, "c").isCode).toBe(true);
    expect(stateAt(e, "l").isLink).toBe(true);
    expect(stateAt(e, "i").isLink).toBe(false);
  });

  it("detects a table and whether its first row is a header", () => {
    const e = makeEditor("<p>outside</p>");
    expect(readToolbarState(e)).toMatchObject({
      isTable: false,
      hasHeaderRow: false,
    });

    e.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    expect(readToolbarState(e)).toMatchObject({
      isTable: true,
      hasHeaderRow: true,
    });

    e.commands.toggleHeaderRow();
    expect(readToolbarState(e).hasHeaderRow).toBe(false);
  });

  it("tracks undo and redo availability", () => {
    const e = makeEditor("<p>start</p>");
    expect(readToolbarState(e)).toMatchObject({
      canUndo: false,
      canRedo: false,
    });

    e.commands.insertContent("more");
    expect(readToolbarState(e)).toMatchObject({
      canUndo: true,
      canRedo: false,
    });

    e.commands.undo();
    expect(readToolbarState(e).canRedo).toBe(true);
  });

  it("reports every flag false for a null editor", () => {
    expect(
      Object.values(readToolbarState(null)).every((v) => v === false)
    ).toBe(true);
  });
});
