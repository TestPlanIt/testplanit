import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ReadOnlyRichText from "./ReadOnlyRichText";
import TipTapEditor from "./TipTapEditor";
import {
  RICH_TEXT_ALL_FEATURES,
  RICH_TEXT_FIXTURE_PARAMETERS,
} from "./__fixtures__/richTextAllFeatures";

vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    projectLlmIntegration: {
      useFindMany: () => ({ data: [], isLoading: false, error: null }),
    },
  }),
}));

vi.mock("~/styles/TipTapEditor.module.css", () => ({
  default: {
    editorContent: "mock-editor-content",
    staticContent: "mock-static-content",
  },
}));

/**
 * The editor paints a few things through node views or editing-only DOM that
 * the static markup expresses differently on purpose. Each rule below names
 * one such difference; anything outside them is a regression.
 */
function canonicalise(root: HTMLElement): string {
  const work = root.cloneNode(true) as HTMLElement;

  // ProseMirror keeps a <br> in every empty text block so the caret has
  // somewhere to sit; static markup has no caret.
  work
    .querySelectorAll("br.ProseMirror-trailingBreak")
    .forEach((br) => br.remove());

  // Atom nodes (chips, emoji images) are marked non-editable inside the
  // editor; the static markup is never editable, and the sanitiser drops the
  // attribute.
  work
    .querySelectorAll("[contenteditable]")
    .forEach((el) => el.removeAttribute("contenteditable"));

  // prosemirror-tables normalises a loaded table so every cell in a column
  // that declares a width carries that width (fixTables); the static markup
  // shows the stored document. Column widths are painted through the
  // <colgroup>, which is compared as-is; the sanitiser keeping `colwidth`
  // is covered in lib/tiptap/readOnlyRichTextHtml.test.ts.
  work
    .querySelectorAll("td[colwidth], th[colwidth]")
    .forEach((el) => el.removeAttribute("colwidth"));

  // The table node view wraps the table for the resize grips, which a
  // read-only editor never shows.
  work.querySelectorAll("div.tableWrapper").forEach((wrapper) => {
    wrapper.replaceWith(...Array.from(wrapper.childNodes));
  });

  // The image node view's container is draggable so an editor can reorder
  // blocks; the static markup is not.
  work
    .querySelectorAll(".react-renderer[draggable]")
    .forEach((el) => el.removeAttribute("draggable"));

  return work.innerHTML;
}

/** One tag per line, so a failure points at the element that differs. */
const perLine = (html: string) => html.replace(/></g, ">\n<");

describe("ReadOnlyRichText renders what the read-only TipTapEditor renders", () => {
  it.each([
    ["with parameters", RICH_TEXT_FIXTURE_PARAMETERS],
    ["without parameters", undefined],
  ])("%s", async (_label, parameters) => {
    const editor = render(
      <TipTapEditor
        content={RICH_TEXT_ALL_FEATURES}
        readOnly
        projectId="1"
        parameters={parameters}
      />
    );
    const editorRoot = await waitFor(() => {
      const root = editor.container.querySelector(
        ".ProseMirror"
      ) as HTMLElement | null;
      expect(root).not.toBeNull();
      // Node views mount asynchronously; both images must be in place.
      expect(
        root!.querySelectorAll("[data-node-view-wrapper] img").length
      ).toBe(2);
      return root!;
    });

    const stat = render(
      <ReadOnlyRichText
        content={RICH_TEXT_ALL_FEATURES}
        parameters={parameters}
      />
    );
    const staticRoot = stat.container.querySelector(
      ".ProseMirror"
    ) as HTMLElement;

    expect(perLine(canonicalise(staticRoot))).toBe(
      perLine(canonicalise(editorRoot))
    );

    editor.unmount();
    stat.unmount();
  });
});
