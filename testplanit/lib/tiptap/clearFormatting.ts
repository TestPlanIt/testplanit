import type { Editor } from "@tiptap/core";

/**
 * Strips every applied style from the current selection: inline marks (bold,
 * italic, underline, strike, inline code, text colour, links) plus block
 * formatting, so headings, lists, blockquotes and code blocks collapse back to
 * plain paragraphs. Mirrors the per-block "Clear formatting" action in the drag
 * handle menu (menus/ContentItemMenu), which resets one node at a time.
 *
 * Tiptap's `unsetAllMarks` returns early on a collapsed cursor while
 * `clearNodes` still acts on the surrounding block, so an empty selection would
 * otherwise lose its heading/list wrapper and keep its bold. Widen to the
 * enclosing text block first so both halves cover the same range.
 */
export function clearFormatting(editor: Editor): boolean {
  const chain = editor.chain().focus();
  const { selection } = editor.state;

  if (selection.empty) {
    const { $from } = selection;
    chain.setTextSelection({ from: $from.start(), to: $from.end() });
  }

  return chain.unsetAllMarks().clearNodes().run();
}
