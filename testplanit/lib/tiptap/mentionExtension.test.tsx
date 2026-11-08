// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMentionExtension } from "./mentionExtension";

vi.mock("~/components/comments/MentionSuggestion", () => ({
  MentionSuggestion: () => null,
}));

const content = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Hi " },
        {
          type: "mention",
          attrs: { id: "user-42", label: "Ada Lovelace", image: null },
        },
      ],
    },
  ],
};

describe("mention extension", () => {
  const realLocation = window.location;
  let editor: Editor;

  beforeEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname: "/de-DE/projects/1", href: "" },
    });
    editor = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit, createMentionExtension(1)],
      content,
    });
  });

  afterEach(() => {
    editor.destroy();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: realLocation,
    });
  });

  it("renders the mention without an inline event handler", () => {
    const html = editor.getHTML();
    expect(html).toContain('data-id="user-42"');
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it("opens the profile in the current locale when a mention is clicked", () => {
    let mentionPos = -1;
    let mentionNode: any = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "mention") {
        mentionPos = pos;
        mentionNode = node;
      }
    });
    expect(mentionNode).not.toBeNull();

    const handled = editor.view.someProp("handleClickOn", (f) =>
      f(
        editor.view,
        mentionPos,
        mentionNode,
        mentionPos,
        new MouseEvent("click"),
        true
      )
    );

    expect(handled).toBe(true);
    expect(window.location.href).toBe("/de-DE/users/profile/user-42");
  });

  it("ignores clicks on other nodes", () => {
    const paragraph = editor.state.doc.firstChild!;
    const handled = editor.view.someProp("handleClickOn", (f) =>
      f(editor.view, 0, paragraph, 0, new MouseEvent("click"), true)
    );
    expect(handled).toBeFalsy();
    expect(window.location.href).toBe("");
  });
});
