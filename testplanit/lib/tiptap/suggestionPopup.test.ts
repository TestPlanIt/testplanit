import type { SuggestionProps } from "@tiptap/suggestion";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { suggestionPopupRenderer } from "./suggestionPopup";

const { renderers } = vi.hoisted(() => ({
  renderers: [] as Array<{
    component: unknown;
    options: { props: unknown; editor: unknown; className?: string };
    element: object;
    ref: { onKeyDown: ReturnType<typeof vi.fn> };
    updateProps: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("@tiptap/react", () => ({
  ReactRenderer: class {
    element = { tagName: "DIV" };
    ref = { onKeyDown: vi.fn(() => true) };
    updateProps = vi.fn();
    destroy = vi.fn();
    constructor(
      public component: unknown,
      public options: { props: unknown; editor: unknown; className?: string }
    ) {
      renderers.push(this);
    }
  },
}));

const List = () => null;

const startProps = () => {
  const unmount = vi.fn();
  const props = {
    editor: { id: "editor" },
    mount: vi.fn(() => unmount),
  } as unknown as SuggestionProps;
  return { props, unmount };
};

const keyDown = (key: string) =>
  ({ event: { key } }) as Parameters<
    NonNullable<
      ReturnType<ReturnType<typeof suggestionPopupRenderer>>["onKeyDown"]
    >
  >[0];

describe("suggestionPopupRenderer", () => {
  beforeEach(() => {
    renderers.length = 0;
  });

  it("renders the list and hands its element to Tiptap to position", () => {
    const { props } = startProps();
    const popup = suggestionPopupRenderer(List)();

    popup.onStart?.(props);

    expect(renderers).toHaveLength(1);
    expect(renderers[0].component).toBe(List);
    expect(renderers[0].options.props).toBe(props);
    expect(renderers[0].options.editor).toBe(props.editor);
    expect(props.mount).toHaveBeenCalledWith(renderers[0].element);
  });

  it("keeps the popup above dialogs and clickable while one is open", () => {
    const { props } = startProps();
    suggestionPopupRenderer(List)().onStart?.(props);

    expect(renderers[0].options.className).toContain("z-[9999]");
    expect(renderers[0].options.className).toContain("pointer-events-auto");
  });

  it("passes updated suggestions to the list", () => {
    const { props } = startProps();
    const popup = suggestionPopupRenderer(List)();
    popup.onStart?.(props);

    const next = { ...props, query: "ad" } as SuggestionProps;
    popup.onUpdate?.(next);

    expect(renderers[0].updateProps).toHaveBeenCalledWith(next);
  });

  it("closes the popup on Escape without forwarding the key", () => {
    const { props, unmount } = startProps();
    const popup = suggestionPopupRenderer(List)();
    popup.onStart?.(props);

    expect(popup.onKeyDown?.(keyDown("Escape"))).toBe(true);

    expect(unmount).toHaveBeenCalledTimes(1);
    expect(renderers[0].ref.onKeyDown).not.toHaveBeenCalled();
  });

  it("forwards other keys to the list and reports whether it handled them", () => {
    const { props, unmount } = startProps();
    const popup = suggestionPopupRenderer(List)();
    popup.onStart?.(props);
    renderers[0].ref.onKeyDown.mockReturnValueOnce(false);

    expect(popup.onKeyDown?.(keyDown("ArrowDown"))).toBe(false);
    expect(popup.onKeyDown?.(keyDown("Enter"))).toBe(true);

    expect(renderers[0].ref.onKeyDown).toHaveBeenCalledTimes(2);
    expect(unmount).not.toHaveBeenCalled();
  });

  it("removes the popup and destroys the list when the suggestion ends", () => {
    const { props, unmount } = startProps();
    const popup = suggestionPopupRenderer(List)();
    popup.onStart?.(props);

    popup.onExit?.(props);

    expect(unmount).toHaveBeenCalledTimes(1);
    expect(renderers[0].destroy).toHaveBeenCalledTimes(1);
  });

  it("does not unmount twice when Escape is followed by the suggestion ending", () => {
    const { props, unmount } = startProps();
    const popup = suggestionPopupRenderer(List)();
    popup.onStart?.(props);

    popup.onKeyDown?.(keyDown("Escape"));
    popup.onExit?.(props);

    expect(unmount).toHaveBeenCalledTimes(1);
  });

  it("ignores keys before a popup exists", () => {
    const popup = suggestionPopupRenderer(List)();

    expect(popup.onKeyDown?.(keyDown("ArrowDown"))).toBe(false);
  });
});
