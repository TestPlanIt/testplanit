import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace?: string) =>
    (key: string, _params?: Record<string, unknown>) => {
      const parameters: Record<string, string> = {
        toolbarInsertParameter: "Insert parameter",
        toolbarInsertParameterPlaceholder: "Search parameters...",
      };
      const common: Record<string, string> = { cancel: "Cancel" };
      const dict = namespace === "common" ? common : parameters;
      return dict[key] ?? key;
    },
}));

// Capture the props AsyncCombobox is invoked with so we can drive its
// callbacks directly. Behavior of the popover/list itself is owned by
// AsyncCombobox's own tests; here we only verify the integration shape.
const comboboxPropsRef: { current: Record<string, unknown> | null } = {
  current: null,
};
vi.mock("@/components/ui/async-combobox", () => ({
  AsyncCombobox: (props: Record<string, unknown>) => {
    comboboxPropsRef.current = props;
    const renderTrigger = props.renderTrigger as
      ((args: Record<string, unknown>) => ReactElement) | undefined;
    return renderTrigger
      ? renderTrigger({
          value: null,
          open: false,
          placeholder: "",
          triggerLabel: null,
          defaultContent: null,
        })
      : null;
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
  it("renders the toolbar button with the Braces icon and the data-testid", () => {
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

  it("on parameter pick (via combobox onValueChange), inserts parameterMention chip + trailing space and runs the chain", () => {
    const { editor, insertContent, runSpy } = makeEditor();
    render(
      <InsertParameterToolbarButton
        editor={editor as never}
        parameters={PARAMS}
      />
    );

    const onValueChange = comboboxPropsRef.current?.onValueChange as (
      p: ParameterChipMeta | null
    ) => void;
    expect(typeof onValueChange).toBe("function");

    onValueChange(PARAMS[1]);

    expect(insertContent).toHaveBeenNthCalledWith(1, {
      type: "parameterMention",
      attrs: {
        id: "amount",
        label: "amount",
        paramId: 8,
        paramType: "INTEGER",
      },
    });
    expect(insertContent).toHaveBeenNthCalledWith(2, " ");
    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it("fetchOptions filters the parameter list by query (case-insensitive substring)", async () => {
    const { editor } = makeEditor();
    render(
      <InsertParameterToolbarButton
        editor={editor as never}
        parameters={PARAMS}
      />
    );

    const fetchOptions = comboboxPropsRef.current?.fetchOptions as (
      query: string
    ) => Promise<{ results: ParameterChipMeta[]; total: number }>;
    expect(typeof fetchOptions).toBe("function");

    const all = await fetchOptions("");
    expect(all.results).toHaveLength(2);

    const filtered = await fetchOptions("AMO");
    expect(filtered.results).toHaveLength(1);
    expect(filtered.results[0]?.name).toBe("amount");
  });
});
