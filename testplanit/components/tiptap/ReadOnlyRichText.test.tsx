import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ParameterChipMeta } from "~/lib/tiptap/parameterMentionExtension";
import ReadOnlyRichText from "./ReadOnlyRichText";

vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

vi.mock("~/styles/TipTapEditor.module.css", () => ({
  default: {
    editorContent: "mock-editor-content",
    staticContent: "mock-static-content",
  },
}));

const doc = (...content: unknown[]) => ({ type: "doc", content });
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (value: string) => ({ type: "text", text: value });
const chip = (label: string) => ({
  type: "parameterMention",
  attrs: { id: label, label, paramId: 1, paramType: "STRING" },
});

const PARAMS: ParameterChipMeta[] = [
  { id: 1, name: "username", type: "STRING", defaultValue: "alice" },
];

describe("ReadOnlyRichText", () => {
  it("renders the document as static markup with the editor's classes", () => {
    const { container } = render(
      <ReadOnlyRichText
        content={doc(paragraph(text("Open the login page")))}
        className="prose-sm"
        data-testid="step-text"
      />
    );
    expect(screen.getByText("Open the login page")).toBeInTheDocument();
    const surface = container.querySelector(".tiptap.ProseMirror");
    expect(surface).not.toBeNull();
    expect(surface).not.toHaveAttribute("contenteditable");
    expect(surface).not.toHaveAttribute("role");
    expect(screen.getByTestId("step-text")).toHaveClass("prose-sm");
  });

  it("renders an empty surface on the server, like the editor", () => {
    const html = renderToString(
      <ReadOnlyRichText content={doc(paragraph(text("client only")))} />
    );
    expect(html).toContain("ProseMirror");
    expect(html).not.toContain("client only");
  });

  it("accepts the stored string form", () => {
    render(
      <ReadOnlyRichText
        content={JSON.stringify(doc(paragraph(text("stringified"))))}
      />
    );
    expect(screen.getByText("stringified")).toBeInTheDocument();
  });

  it("renders parameter chips with substituted values", () => {
    const { container } = render(
      <ReadOnlyRichText
        content={doc(paragraph(chip("username")))}
        parameters={PARAMS}
      />
    );
    const node = container.querySelector(".parameter-ref-chip");
    expect(node).not.toBeNull();
    expect(node).toHaveTextContent("@username: alice");
    expect(node).toHaveAttribute("data-value", "alice");
    expect(
      screen.queryByTestId("tiptap-undeclared-parameter-warning")
    ).toBeNull();
  });

  it("warns about chips the surface does not declare", () => {
    render(
      <ReadOnlyRichText
        content={doc(paragraph(chip("missing")))}
        parameters={PARAMS}
      />
    );
    expect(
      screen.getByTestId("tiptap-undeclared-parameter-warning")
    ).toHaveTextContent("@missing");
  });

  it("shows no warning on a surface without parameters", () => {
    render(<ReadOnlyRichText content={doc(paragraph(chip("missing")))} />);
    expect(
      screen.queryByTestId("tiptap-undeclared-parameter-warning")
    ).toBeNull();
    expect(screen.getByText("@missing")).toBeInTheDocument();
  });

  it("renders stored values that are not documents as empty", () => {
    const { container } = render(<ReadOnlyRichText content={null} />);
    expect(container.querySelector(".tiptap.ProseMirror")?.innerHTML).toBe(
      '<p><br class="ProseMirror-trailingBreak"></p>'
    );
  });
});
