import Mention from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions } from "@tiptap/suggestion";
import tippy, { type Instance as TippyInstance } from "tippy.js";

import {
  ParameterMentionSuggestion,
  type ParameterMentionSuggestionRef,
} from "~/components/tiptap/ParameterMentionSuggestion";

export interface ParameterChipMeta {
  id: number;
  name: string;
  type: "STRING" | "INTEGER" | "BOOLEAN" | "SELECT";
  defaultValue: string | null;
}

export function createParameterMentionExtension(
  parameters: ParameterChipMeta[]
) {
  const declaredNames = new Set(parameters.map((p) => p.name));

  return Mention.extend({
    name: "parameterMention",

    addAttributes() {
      const parentAttributes =
        (this.parent as undefined | (() => Record<string, unknown>))?.() ?? {};

      return {
        ...parentAttributes,
        paramId: {
          default: null,
          parseHTML: (element: HTMLElement) =>
            element.getAttribute("data-param-id"),
          renderHTML: (attributes: { paramId: number | string | null }) => {
            if (attributes.paramId === null || attributes.paramId === undefined) {
              return {};
            }
            return { "data-param-id": String(attributes.paramId) };
          },
        },
        paramType: {
          default: null,
          parseHTML: (element: HTMLElement) =>
            element.getAttribute("data-param-type"),
          renderHTML: (attributes: { paramType: string | null }) => {
            if (!attributes.paramType) return {};
            return { "data-param-type": attributes.paramType };
          },
        },
      };
    },

    renderHTML({
      node,
      HTMLAttributes,
    }: {
      node: { attrs: Record<string, unknown> };
      HTMLAttributes: Record<string, unknown>;
    }) {
      const label = (node.attrs.label as string) ?? "";
      const id = (node.attrs.id as string) ?? label;
      const paramId = node.attrs.paramId as number | string | null | undefined;
      const paramType = node.attrs.paramType as string | null | undefined;
      const undeclared = !declaredNames.has(label);

      const attrs: Record<string, unknown> = {
        ...HTMLAttributes,
        class: "parameter-ref-chip",
        "data-type": "parameterMention",
        "data-id": id,
        "data-label": label,
        "data-undeclared": undeclared ? "true" : "false",
        contenteditable: "false",
      };
      if (paramId !== null && paramId !== undefined) {
        attrs["data-param-id"] = String(paramId);
      }
      if (paramType) {
        attrs["data-param-type"] = paramType;
      }

      return ["span", attrs, `@${label}`];
    },
  }).configure({
    HTMLAttributes: {
      class: "parameter-ref-chip",
    },
    suggestion: {
      char: "@",
      items: ({ query }: { query: string }) => {
        const lowered = query.toLowerCase();
        return parameters
          .filter((p) => p.name.toLowerCase().startsWith(lowered))
          .slice(0, 8);
      },
      command: ({
        editor,
        range,
        props,
      }: {
        editor: {
          chain: () => {
            focus: () => {
              deleteRange: (range: { from: number; to: number }) => {
                insertContent: (
                  content:
                    | string
                    | { type: string; attrs: Record<string, unknown> }
                    | Array<unknown>
                ) => { run: () => void };
              };
            };
          };
        };
        range: { from: number; to: number };
        props: ParameterChipMeta;
      }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent([
            {
              type: "parameterMention",
              attrs: {
                id: props.name,
                label: props.name,
                paramId: props.id,
                paramType: props.type,
              },
            },
            { type: "text", text: " " },
          ] as Array<unknown>)
          .run();
      },
      render: () => {
        let component: ReactRenderer<ParameterMentionSuggestionRef> | undefined;
        let popup: TippyInstance[] | undefined;

        return {
          onStart: (props: {
            editor: unknown;
            clientRect?: (() => DOMRect | null) | null;
          }) => {
            component = new ReactRenderer(ParameterMentionSuggestion, {
              props: props as unknown as Record<string, unknown>,
              editor: props.editor as never,
            });

            if (!props.clientRect) return;

            popup = tippy("body", {
              getReferenceClientRect: props.clientRect as () => DOMRect,
              appendTo: () => document.body,
              content: component.element,
              showOnCreate: true,
              interactive: true,
              trigger: "manual",
              placement: "bottom-start",
            });
          },

          onUpdate(props: {
            clientRect?: (() => DOMRect | null) | null;
          }) {
            component?.updateProps(props as unknown as Record<string, unknown>);
            if (!props.clientRect) return;
            popup?.[0]?.setProps({
              getReferenceClientRect: props.clientRect as () => DOMRect,
            });
          },

          onKeyDown(props: { event: KeyboardEvent }) {
            if (props.event.key === "Escape") {
              popup?.[0]?.hide();
              return true;
            }
            return component?.ref?.onKeyDown(props) ?? false;
          },

          onExit() {
            popup?.[0]?.destroy();
            component?.destroy();
          },
        };
      },
    } as Partial<SuggestionOptions>,
  });
}
