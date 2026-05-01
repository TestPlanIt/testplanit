import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (
    key: string,
    _params?: Record<string, unknown>
  ) => {
    const parameters: Record<string, string> = {
      toolbarInsertParameter: "Insert parameter",
      chooserTitle: "Insert parameter",
      chooserDescription:
        "Choose a parameter to insert at the cursor position.",
      chooserSearchPlaceholder: "Search parameters...",
      chooserEmpty: "No parameters declared yet.",
      chooserConfigureLink: "Configure parameters",
    };
    const common: Record<string, string> = { cancel: "Cancel" };
    const dict = namespace === "common" ? common : parameters;
    return dict[key] ?? key;
  },
}));

import { InsertParameterToolbarButton } from "@/components/tiptap/InsertParameterToolbarButton";
import type { ParameterChipMeta } from "~/lib/tiptap/parameterMentionExtension";

const PARAMS: ParameterChipMeta[] = [
  { id: 7, name: "username", type: "STRING", defaultValue: "alice" },
  { id: 8, name: "amount", type: "INTEGER", defaultValue: "100" },
];

interface ChainSpy {
  focus: () => ChainSpy;
  insertContent: ReturnType<typeof vi.fn>;
  run: () => void;
}

function makeEditor(): {
  editor: { chain: () => ChainSpy };
  insertContent: ChainSpy["insertContent"];
  runSpy: ReturnType<typeof vi.fn>;
} {
  const insertContent = vi.fn();
  const runSpy = vi.fn();
  const chain: ChainSpy = {
    focus: () => chain,
    insertContent: insertContent.mockImplementation(() => chain),
    run: runSpy,
  };
  return {
    editor: { chain: () => chain },
    insertContent,
    runSpy,
  };
}

describe("InsertParameterToolbarButton", () => {
  it("renders the toolbar button with Braces icon and the data-testid", () => {
    const { editor } = makeEditor();
    render(
      <InsertParameterToolbarButton
        editor={editor as never}
        parameters={PARAMS}
      />
    );
    expect(
      screen.getByTestId("tiptap-insert-parameter-button")
    ).toBeInTheDocument();
  });

  it("opens the chooser dialog on click", () => {
    const { editor } = makeEditor();
    render(
      <InsertParameterToolbarButton
        editor={editor as never}
        parameters={PARAMS}
      />
    );
    expect(
      screen.queryByTestId("parameter-chooser-dialog")
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tiptap-insert-parameter-button"));
    expect(screen.getByTestId("parameter-chooser-dialog")).toBeVisible();
  });

  it("on item pick, calls editor.chain().focus().insertContent(parameterMention).insertContent(' ').run() and closes", () => {
    const { editor, insertContent, runSpy } = makeEditor();
    render(
      <InsertParameterToolbarButton
        editor={editor as never}
        parameters={PARAMS}
      />
    );
    fireEvent.click(screen.getByTestId("tiptap-insert-parameter-button"));
    fireEvent.click(screen.getByTestId("parameter-chooser-item-amount"));

    // First insertContent: parameterMention node.
    expect(insertContent).toHaveBeenNthCalledWith(1, {
      type: "parameterMention",
      attrs: { id: "amount", label: "amount", paramId: 8, paramType: "INTEGER" },
    });
    // Second insertContent: trailing space.
    expect(insertContent).toHaveBeenNthCalledWith(2, " ");
    expect(runSpy).toHaveBeenCalledTimes(1);

    // Dialog closed after pick.
    expect(
      screen.queryByTestId("parameter-chooser-dialog")
    ).not.toBeInTheDocument();
  });
});
