import Mention from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import type { SuggestionOptions } from "@tiptap/suggestion";
import { toast } from "sonner";
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
  /**
   * Whether the parameter is marked sensitive in the snapshot. When true and a
   * value is provided, the chip renders `••••••` with a click-to-reveal toggle.
   * When the viewer lacks `canReadSensitive`, the wrapper should null out
   * `defaultValue` server-side (or provide `[REDACTED]`) before passing the
   * chip meta down — the extension trusts the value it receives.
   */
  sensitive?: boolean;
}

/**
 * Caller-provided translated strings used in chip rendering and the global
 * click handler. The extension is a vanilla module with no React context, so
 * the caller (which IS a React component, e.g. TipTapEditor) translates via
 * `useTranslations` and passes the formatted strings in. Toast strings carry
 * label interpolation as functions.
 *
 * If omitted, English fallbacks are used — keeps non-React callers (tests,
 * legacy code) functional without forcing them to wire i18n.
 */
export interface ParameterMentionMessages {
  clickToReveal: string;
  copyValue: string;
  copyAriaLabel: (label: string) => string;
  copiedToast: (label: string) => string;
  copyFailedToast: (label: string) => string;
}

const DEFAULT_MESSAGES: ParameterMentionMessages = {
  clickToReveal: "Click to reveal",
  copyValue: "Copy value",
  copyAriaLabel: (label: string) => `Copy ${label} value to clipboard`,
  copiedToast: (label: string) => `Copied @${label} to clipboard`,
  copyFailedToast: (label: string) => `Failed to copy @${label} to clipboard`,
};

const SENSITIVE_MASK = "••••••";

// The copy icon is rendered as an empty span styled via CSS mask-image (see
// the inline style block in TipTapEditor.tsx) so the markup can stay simple
// — ProseMirror's renderHTML schema doesn't accept inner innerHTML, and
// nesting raw SVG via the array form runs into namespace handling issues.

function renderChipText(label: string, valueText: string | null): string {
  if (valueText === null) return `@${label}`;
  return `@${label}: ${valueText}`;
}

/**
 * Install a single document-level handler covering BOTH:
 *  - click-to-reveal on sensitive chips (mask ↔ real value)
 *  - copy-to-clipboard via the embedded copy icon
 *
 * Uses pointerdown in the capture phase so ProseMirror's editor click
 * handlers (which can call preventDefault on bubble) don't swallow it.
 * Idempotent: only installs once per session.
 */
let chipHandlerInstalled = false;
// Per-button timeout tracker so rapid re-clicks restart the ping animation
// cleanly instead of stomping on each other.
const copyTimeouts = new WeakMap<HTMLElement, number>();

function triggerCopyPing(copyBtn: HTMLElement): void {
  const pending = copyTimeouts.get(copyBtn);
  if (pending !== undefined) window.clearTimeout(pending);
  // Remove then re-add the attribute on the next frame so CSS sees a state
  // transition and restarts the animation from 0%.
  copyBtn.removeAttribute("data-copied");
  window.requestAnimationFrame(() => {
    copyBtn.setAttribute("data-copied", "true");
  });
  const id = window.setTimeout(() => {
    copyBtn.removeAttribute("data-copied");
    copyTimeouts.delete(copyBtn);
  }, 1200);
  copyTimeouts.set(copyBtn, id);
}

function installChipHandler() {
  if (chipHandlerInstalled || typeof document === "undefined") return;
  chipHandlerInstalled = true;

  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      // Copy icon click — copies the chip's real value to clipboard.
      const copyBtn = target.closest<HTMLElement>(".parameter-ref-chip-copy");
      if (copyBtn) {
        event.preventDefault();
        event.stopPropagation();
        const chip = copyBtn.closest<HTMLElement>(".parameter-ref-chip");
        const value = chip?.getAttribute("data-value");
        const successMessage =
          copyBtn.getAttribute("data-toast-success") ?? "Copied to clipboard";
        const errorMessage =
          copyBtn.getAttribute("data-toast-error") ??
          "Failed to copy to clipboard";
        if (value && navigator.clipboard) {
          void navigator.clipboard.writeText(value).then(
            () => {
              triggerCopyPing(copyBtn);
              toast.success(successMessage);
            },
            () => {
              toast.error(errorMessage);
            }
          );
        }
        return;
      }

      // Sensitive chip click — toggle reveal.
      const chip = target.closest<HTMLElement>(
        ".parameter-ref-chip[data-sensitive='true']"
      );
      if (!chip) return;
      // Ignore clicks landing on inner non-text spans we own (we already
      // handled the copy button above; this guards future inner controls).
      if (target.closest(".parameter-ref-chip-copy")) return;

      const value = chip.getAttribute("data-value");
      const label = chip.getAttribute("data-label") ?? "";
      if (value === null) return;
      event.preventDefault();
      event.stopPropagation();

      const revealed = chip.getAttribute("data-revealed") === "true";
      const textNode = chip.querySelector<HTMLElement>(
        ".parameter-ref-chip-text"
      );
      if (!textNode) return;

      if (revealed) {
        chip.setAttribute("data-revealed", "false");
        textNode.textContent = renderChipText(label, SENSITIVE_MASK);
      } else {
        chip.setAttribute("data-revealed", "true");
        textNode.textContent = renderChipText(label, value);
      }
    },
    /* useCapture */ true
  );
}

export function createParameterMentionExtension(
  parameters: ParameterChipMeta[],
  messages: ParameterMentionMessages = DEFAULT_MESSAGES
) {
  installChipHandler();
  const declaredNames = new Set(parameters.map((p) => p.name));
  const paramByName = new Map(parameters.map((p) => [p.name, p]));

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
            if (
              attributes.paramId === null ||
              attributes.paramId === undefined
            ) {
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

      const meta = paramByName.get(label);
      const hasValue =
        meta?.defaultValue !== null && meta?.defaultValue !== undefined;
      const isSensitive = !!meta?.sensitive;

      const visibleText = !hasValue
        ? `@${label}`
        : isSensitive
          ? renderChipText(label, SENSITIVE_MASK)
          : renderChipText(label, meta!.defaultValue);

      const classes = ["parameter-ref-chip"];
      if (isSensitive) classes.push("parameter-ref-chip-sensitive");
      if (hasValue) classes.push("parameter-ref-chip-with-value");

      const attrs: Record<string, unknown> = {
        ...HTMLAttributes,
        class: classes.join(" "),
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
      if (hasValue) {
        attrs["data-value"] = meta!.defaultValue!;
      }
      if (isSensitive && hasValue) {
        attrs["data-sensitive"] = "true";
        attrs["data-revealed"] = "false";
        attrs["title"] = messages.clickToReveal;
        attrs["role"] = "button";
        attrs["tabindex"] = "0";
      }

      // Build inner structure: [text span] + optional [copy icon button].
      // Text lives in its own span so click-toggle can update only that node
      // without disturbing the copy icon.
      const children: Array<unknown> = [
        ["span", { class: "parameter-ref-chip-text" }, visibleText],
      ];
      if (hasValue) {
        // Toast strings are pre-translated at render time and stashed on the
        // copy button's data attributes — the global click handler reads them
        // back at click time without needing access to the React i18n context.
        children.push([
          "span",
          {
            class: "parameter-ref-chip-copy",
            role: "button",
            "aria-label": messages.copyAriaLabel(label),
            title: messages.copyValue,
            tabindex: "0",
            "data-toast-success": messages.copiedToast(label),
            "data-toast-error": messages.copyFailedToast(label),
          },
        ]);
      }

      return ["span", attrs, ...children];
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

          onUpdate(props: { clientRect?: (() => DOMRect | null) | null }) {
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
