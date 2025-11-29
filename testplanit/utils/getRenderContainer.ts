import { Editor } from "@tiptap/react";

export const getRenderContainer = (
  editor: Editor,
  nodeType: string
): HTMLElement | null => {
  const {
    view,
    state: {
      selection: { from },
    },
  } = editor;

  const elements = document.querySelectorAll(".has-focus");
  const elementCount = elements.length;
  const innermostNode = elements[elementCount - 1];
  const element = innermostNode as HTMLElement | null;

  if (
    (element && element.getAttribute("data-type") === nodeType) ||
    (element && element.classList.contains(nodeType))
  ) {
    return element;
  }

  const node = view.domAtPos(from).node as HTMLElement;
  let container: HTMLElement | null = node;

  if (!container.tagName) {
    container = node.parentElement;
  }

  while (
    container &&
    !(container.getAttribute("data-type") === nodeType) &&
    !container.classList.contains(nodeType)
  ) {
    container = container.parentElement;
  }

  return container;
};

export default getRenderContainer;
