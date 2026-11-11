import { ReactRenderer } from "@tiptap/react";
import type {
  SuggestionKeyDownProps,
  SuggestionOptions,
  SuggestionProps,
} from "@tiptap/suggestion";
import type { ComponentType } from "react";

interface SuggestionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

/**
 * The popup is appended to <body>, outside any open dialog: it has to sit
 * above the dialog and stay clickable while the dialog disables pointer
 * events on the rest of the page.
 */
const POPUP_CLASS_NAME = "z-[9999] pointer-events-auto";

/**
 * Renders a suggestion list component in a popup that Tiptap positions and
 * keeps anchored to the cursor.
 */
export function suggestionPopupRenderer<TRef extends SuggestionListRef>(
  // Each list component declares its own props.
  ListComponent: ComponentType<any>
): NonNullable<SuggestionOptions["render"]> {
  return () => {
    let component: ReactRenderer<TRef> | undefined;
    let unmount: (() => void) | undefined;

    const closePopup = () => {
      unmount?.();
      unmount = undefined;
    };

    return {
      onStart(props: SuggestionProps) {
        component = new ReactRenderer(ListComponent, {
          props,
          editor: props.editor,
          className: POPUP_CLASS_NAME,
        });
        unmount = props.mount(component.element);
      },

      onUpdate(props: SuggestionProps) {
        component?.updateProps(props);
      },

      onKeyDown(props: SuggestionKeyDownProps) {
        if (props.event.key === "Escape") {
          closePopup();
          return true;
        }
        return component?.ref?.onKeyDown(props) ?? false;
      },

      onExit() {
        closePopup();
        component?.destroy();
        component = undefined;
      },
    };
  };
}
