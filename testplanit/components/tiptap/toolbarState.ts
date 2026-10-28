import type { Editor } from "@tiptap/core";

import { findTable } from "~/app/extensions/Table/utils";

/**
 * Everything the toolbar reads out of live editor state. Tiptap v3's `useEditor`
 * no longer re-renders on each transaction (`shouldRerenderOnTransaction`
 * defaults to off), so reading `editor.isActive(...)` straight from the render
 * body leaves the toolbar showing whichever state the last unrelated re-render
 * happened to catch — buttons stay dark when you move the caret into bold text.
 * `useEditorState` subscribes to transactions and, because it diffs the
 * selected value, only re-renders when one of these flags actually flips.
 */
export type ToolbarState = ReturnType<typeof readToolbarState>;

export const readToolbarState = (editor: Editor | null) => ({
  isBold: !!editor?.isActive("bold"),
  isItalic: !!editor?.isActive("italic"),
  isStrike: !!editor?.isActive("strike"),
  isUnderline: !!editor?.isActive("underline"),
  isCode: !!editor?.isActive("code"),
  isParagraph: !!editor?.isActive("paragraph"),
  isHeading1: !!editor?.isActive("heading", { level: 1 }),
  isHeading2: !!editor?.isActive("heading", { level: 2 }),
  isHeading3: !!editor?.isActive("heading", { level: 3 }),
  isCodeBlock: !!editor?.isActive("codeBlock"),
  isBulletList: !!editor?.isActive("bulletList"),
  isOrderedList: !!editor?.isActive("orderedList"),
  isBlockquote: !!editor?.isActive("blockquote"),
  isTable: !!editor?.isActive("table"),
  isLink: !!editor?.isActive("link"),
  hasHeaderRow:
    editor !== null &&
    findTable(editor.state.selection)?.node.firstChild?.firstChild?.type
      .name === "tableHeader",
  canUndo: !!editor?.can().undo(),
  canRedo: !!editor?.can().redo(),
});
