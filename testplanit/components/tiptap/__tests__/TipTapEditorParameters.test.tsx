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
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TipTapEditor parameters wiring", () => {
  it("does NOT mount the parameter mention extension when parameters prop is undefined", async () => {
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
    expect(hasParameterMention).toBe(false);
  });

  it("does NOT mount the parameter mention extension when parameters is empty []", async () => {
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
    expect(hasParameterMention).toBe(false);
  });

  it("DOES mount the parameter mention extension when parameters is non-empty", async () => {
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
