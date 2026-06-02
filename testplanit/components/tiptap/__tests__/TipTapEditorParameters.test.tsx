import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ParameterChipMeta } from "~/lib/tiptap/parameterMentionExtension";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock ZenStack hooks (TipTapEditor uses one)
vi.mock("~/lib/hooks/project-llm-integration", () => ({
  useFindManyProjectLlmIntegration: () => ({
    data: [],
    isLoading: false,
    error: null,
  }),
}));

// Mock the CSS module
vi.mock("~/styles/TipTapEditor.module.css", () => ({
  default: { editorContent: "mock-editor-content" },
}));

vi.mock("../LoadingSpinnerAlert", () => ({
  default: () => null,
}));

vi.mock("../video", () => ({
  Video: { name: "video", group: "block" },
}));

vi.mock("~/utils", () => ({
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
}));

vi.mock("~/app/constants", () => ({
  emptyEditorContent: { type: "doc", content: [] },
}));

// Capture the extensions array passed to useEditor.
const capturedConfigs: Array<{ extensions: unknown[] }> = [];

// Spy on the parameter-mention factory so the suggestion-gating contract
// can be asserted directly without introspecting Tiptap output. The factory
// is called by TipTapEditor on every mount; we record the (parameters,
// messages, options) arguments and return a marker object the
// extensions-array assertions can detect.
const factoryCalls: Array<{
  parameters: unknown;
  messages: unknown;
  options: { withSuggestion?: boolean } | undefined;
}> = [];
vi.mock("~/lib/tiptap/parameterMentionExtension", async () => {
  const actual = await vi.importActual<
    typeof import("~/lib/tiptap/parameterMentionExtension")
  >("~/lib/tiptap/parameterMentionExtension");
  return {
    ...actual,
    createParameterMentionExtension: (
      parameters: unknown,
      messages: unknown,
      options?: { withSuggestion?: boolean }
    ) => {
      factoryCalls.push({ parameters, messages, options });
      // Return a shape the existing extensions-array assertions can detect.
      return { name: "parameterMention" };
    },
  };
});

vi.mock("@tiptap/react", () => ({
  useEditor: (config: { extensions: unknown[] }) => {
    capturedConfigs.push(config);
    return {
      isActive: vi.fn(() => false),
      can: vi.fn(() => ({ undo: () => true, redo: () => true })),
      getAttributes: vi.fn(() => ({ href: "" })),
      getJSON: vi.fn(() => ({ type: "doc", content: [] })),
      setEditable: vi.fn(),
      state: { doc: { content: { size: 0 } } },
      chain: vi.fn(() => ({
        focus: vi.fn(() => ({
          toggleBold: vi.fn(() => ({ run: vi.fn() })),
          toggleItalic: vi.fn(() => ({ run: vi.fn() })),
          toggleStrike: vi.fn(() => ({ run: vi.fn() })),
          toggleUnderline: vi.fn(() => ({ run: vi.fn() })),
          toggleCode: vi.fn(() => ({ run: vi.fn() })),
          setColor: vi.fn(() => ({ run: vi.fn() })),
          insertContent: vi.fn(() => ({ run: vi.fn() })),
          undo: vi.fn(() => ({ run: vi.fn() })),
          redo: vi.fn(() => ({ run: vi.fn() })),
          unsetLink: vi.fn(() => ({ run: vi.fn() })),
          extendMarkRange: vi.fn(() => ({
            setLink: vi.fn(() => ({ run: vi.fn() })),
          })),
        })),
      })),
    };
  },
  EditorContent: () => <div data-testid="editor-content" />,
}));

const PARAMS: ParameterChipMeta[] = [
  { id: 1, name: "username", type: "STRING", defaultValue: "alice" },
  { id: 2, name: "amount", type: "INTEGER", defaultValue: "100" },
];

beforeEach(() => {
  capturedConfigs.length = 0;
  factoryCalls.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TipTapEditor parameters wiring", () => {
  it("ALWAYS mounts the parameter mention extension when parameters prop is undefined (so step content with parameter references can deserialize without 'Unknown node type')", async () => {
    const TipTapEditor = (await import("../TipTapEditor")).default;
    render(
      <TipTapEditor content={{ type: "doc", content: [] }} projectId="1" />
    );
    const config = capturedConfigs[0];
    expect(config).toBeDefined();
    const hasParameterMention = config!.extensions.some(
      (ext) =>
        typeof ext === "object" &&
        ext !== null &&
        (ext as { name?: string }).name === "parameterMention"
    );
    expect(hasParameterMention).toBe(true);
    // Suggestion popup must NOT be wired when there are no parameters —
    // otherwise typing `@` in a comment / description / project doc would
    // pop a parameter-picker.
    expect(factoryCalls.length).toBeGreaterThan(0);
    expect(factoryCalls[0].options?.withSuggestion).toBe(false);
  });

  it("ALWAYS mounts the parameter mention extension when parameters is empty []", async () => {
    const TipTapEditor = (await import("../TipTapEditor")).default;
    render(
      <TipTapEditor
        content={{ type: "doc", content: [] }}
        projectId="1"
        parameters={[]}
      />
    );
    const config = capturedConfigs[0];
    expect(config).toBeDefined();
    const hasParameterMention = config!.extensions.some(
      (ext) =>
        typeof ext === "object" &&
        ext !== null &&
        (ext as { name?: string }).name === "parameterMention"
    );
    expect(hasParameterMention).toBe(true);
    expect(factoryCalls.length).toBeGreaterThan(0);
    expect(factoryCalls[0].options?.withSuggestion).toBe(false);
  });

  it("DOES mount the parameter mention extension AND wires the suggestion popup when parameters is non-empty and editor is editable", async () => {
    const TipTapEditor = (await import("../TipTapEditor")).default;
    render(
      <TipTapEditor
        content={{ type: "doc", content: [] }}
        projectId="1"
        parameters={PARAMS}
      />
    );
    const config = capturedConfigs[0];
    expect(config).toBeDefined();
    const hasParameterMention = config!.extensions.some(
      (ext) =>
        typeof ext === "object" &&
        ext !== null &&
        (ext as { name?: string }).name === "parameterMention"
    );
    expect(hasParameterMention).toBe(true);
    expect(factoryCalls.length).toBeGreaterThan(0);
    expect(factoryCalls[0].options?.withSuggestion).toBe(true);
  });

  it("mounts the node WITHOUT the suggestion popup when readOnly is true (read-only previews never need the `@`-picker, but must still render parameter chips)", async () => {
    const TipTapEditor = (await import("../TipTapEditor")).default;
    render(
      <TipTapEditor
        content={{ type: "doc", content: [] }}
        projectId="1"
        parameters={PARAMS}
        readOnly
      />
    );
    expect(factoryCalls.length).toBeGreaterThan(0);
    expect(factoryCalls[0].options?.withSuggestion).toBe(false);
  });

  it("renders the InsertParameterToolbarButton when parameters is non-empty AND not readOnly", async () => {
    const TipTapEditor = (await import("../TipTapEditor")).default;
    render(
      <TipTapEditor
        content={{ type: "doc", content: [] }}
        projectId="1"
        parameters={PARAMS}
      />
    );
    expect(
      screen.getByTestId("tiptap-insert-parameter-button")
    ).toBeInTheDocument();
  });

  it("does NOT render the InsertParameterToolbarButton when parameters is undefined", async () => {
    const TipTapEditor = (await import("../TipTapEditor")).default;
    render(
      <TipTapEditor content={{ type: "doc", content: [] }} projectId="1" />
    );
    expect(
      screen.queryByTestId("tiptap-insert-parameter-button")
    ).not.toBeInTheDocument();
  });

  it("does NOT render the InsertParameterToolbarButton when parameters is []", async () => {
    const TipTapEditor = (await import("../TipTapEditor")).default;
    render(
      <TipTapEditor
        content={{ type: "doc", content: [] }}
        projectId="1"
        parameters={[]}
      />
    );
    expect(
      screen.queryByTestId("tiptap-insert-parameter-button")
    ).not.toBeInTheDocument();
  });

  it("does NOT render the toolbar (or toolbar parameter button) when readOnly", async () => {
    const TipTapEditor = (await import("../TipTapEditor")).default;
    render(
      <TipTapEditor
        content={{ type: "doc", content: [] }}
        projectId="1"
        parameters={PARAMS}
        readOnly
      />
    );
    expect(
      screen.queryByTestId("tiptap-insert-parameter-button")
    ).not.toBeInTheDocument();
  });
});
