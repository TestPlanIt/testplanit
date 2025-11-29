import { mergeAttributes } from "@tiptap/core";
import { Figure } from "../Figure";
import { Quote } from "./Quote";
import { QuoteCaption } from "./QuoteCaption";

declare module "@tiptap/core" {
  // eslint-disable-next-line no-unused-vars
  interface Commands<ReturnType> {
    blockquoteFigure: {
      setBlockquote: () => ReturnType;
    };
  }
}

export const BlockquoteFigure = Figure.extend({
  name: "blockquoteFigure",

  group: "block",

  content: "quote quoteCaption",

  isolating: true,

  addExtensions() {
    return [Quote, QuoteCaption];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return [
      "figure",
      mergeAttributes(HTMLAttributes, { "data-type": this.name }),
      ["div", {}, 0],
    ];
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => false,
    };
  },

  addAttributes() {
    return {
      ...(this as any).parent?.(),
    };
  },

  addCommands() {
    return {
      setBlockquote:
        () =>
        ({ state, chain }: { state: any; chain: any }) => {
          const position = state.selection.$from.start();
          const selectionContent = state.selection.content();

          return chain()
            .focus()
            .insertContent({
              type: this.name,
              content: [
                {
                  type: "quote",
                  content: selectionContent.content.toJSON() || [
                    {
                      type: "paragraph",
                      attrs: {
                        textAlign: "left",
                      },
                    },
                  ],
                },
                {
                  type: "quoteCaption",
                },
              ],
            })
            .focus(position + 1)
            .run();
        },
    } as any;
  },
});

export default BlockquoteFigure;
