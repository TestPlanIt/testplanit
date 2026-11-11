// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMentionExtension } from "./mentionExtension";

vi.mock("~/components/comments/MentionSuggestion", () => ({
  MentionSuggestion: () => null,
}));

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));
vi.mock("~/lib/basePath", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/basePath")>()),
  apiFetch: mockApiFetch,
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

  describe("user lookup", () => {
    const suggestion = () =>
      createMentionExtension(7).options.suggestion as {
        debounce?: number;
        items: (props: {
          query: string;
          signal: AbortSignal;
        }) => Promise<Array<{ id: string }>>;
      };

    const user = (id: string, name: string, extra = {}) => ({
      id,
      name,
      email: `${id}@example.test`,
      isActive: true,
      isDeleted: false,
      isProjectMember: false,
      ...extra,
    });

    beforeEach(() => {
      mockApiFetch.mockReset();
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("waits for typing to pause before looking users up", () => {
      expect(suggestion().debounce).toBeGreaterThan(0);
    });

    it("passes the abort signal to the request so a newer keystroke cancels it", async () => {
      mockApiFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ users: [] }),
      });
      const controller = new AbortController();

      await suggestion().items({ query: "a d", signal: controller.signal });

      expect(mockApiFetch).toHaveBeenCalledWith(
        "/api/users/search-for-mentions?q=a%20d&projectId=7",
        { signal: controller.signal }
      );
    });

    it("returns active users with project members first, then by name", async () => {
      mockApiFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          users: [
            user("zed", "Zed"),
            user("gone", "Gone", { isDeleted: true }),
            user("idle", "Idle", { isActive: false }),
            user("mia", "Mia", { isProjectMember: true }),
            user("ada", "Ada"),
          ],
        }),
      });

      const users = await suggestion().items({
        query: "",
        signal: new AbortController().signal,
      });

      expect(users.map((u) => u.id)).toEqual(["mia", "ada", "zed"]);
    });

    it("returns nothing, without logging, when the lookup was superseded", async () => {
      const controller = new AbortController();
      mockApiFetch.mockImplementation(async () => {
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      });

      const users = await suggestion().items({
        query: "ad",
        signal: controller.signal,
      });

      expect(users).toEqual([]);
      expect(console.error).not.toHaveBeenCalled();
    });

    it("returns nothing and logs when the lookup fails for another reason", async () => {
      mockApiFetch.mockRejectedValue(new Error("network down"));

      const users = await suggestion().items({
        query: "ad",
        signal: new AbortController().signal,
      });

      expect(users).toEqual([]);
      expect(console.error).toHaveBeenCalled();
    });
  });
});
