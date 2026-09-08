// @vitest-environment jsdom
import { getSchema } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Node } from "@tiptap/pm/model";
import { describe, it, expect } from "vitest";
import { ImageWithResize } from "./ImageWithResize";

/**
 * Regression guard for the block-level-image crash.
 *
 * The rich-text editor stores images as block-level nodes (the custom Image
 * extension sets group:"block", and all historical content places images as
 * direct children of `doc`). The image extension must therefore be configured
 * `inline: false`. If it is `inline: true`, the node is flagged inline but lives
 * at block level — a contradiction @tiptap 3.26 tolerated but 3.27's stricter
 * content validation rejects with "Called contentMatchAt on a node with invalid
 * content", which crashed the always-mounted DragHandle on any doc containing an
 * image (e.g. shared-steps / documentation / rich case fields).
 */
const blockImageDoc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Step 1 with an image" }],
    },
    { type: "paragraph" },
    { type: "image", attrs: { src: "https://example.com/x.png" } },
  ],
};

describe("rich-text editor: block-level image schema", () => {
  it("accepts a block-level image when the Image extension is block (inline:false)", () => {
    const schema = getSchema([
      StarterKit,
      ImageWithResize.configure({ inline: false }),
    ]);
    expect(() => Node.fromJSON(schema, blockImageDoc).check()).not.toThrow();
  });

  it("rejects it when misconfigured inline:true — guards against reintroducing the crash", () => {
    const schema = getSchema([
      StarterKit,
      ImageWithResize.configure({ inline: true }),
    ]);
    expect(() => Node.fromJSON(schema, blockImageDoc).check()).toThrow();
  });
});
