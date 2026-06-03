import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    const dict: Record<string, string> = {
      tabParameters: "Parameters",
      tabDataset: "Dataset",
      formAdd: "Add parameter",
      formName: "Name",
      formType: "Type",
      formRequired: "Required",
      formSensitive: "Sensitive",
      datasetAddRow: "Add row",
      datasetLabelColumn: "Label",
      datasetEmptyHeading: "No rows yet",
      datasetAddColumnDuplicate: "Duplicate name",
      emptyHeading: "No parameters yet",
      tabDatasetDisabledTooltip: "Add a parameter first",
      deleteAria: "Delete",
    };
    return dict[key] ?? key + (vars ? `(${JSON.stringify(vars)})` : "");
  },
}));

import { InlineDatasetEditor } from "@/components/parameters/InlineDatasetEditor";
import type {
  InlineDatasetEditorProps,
  InlineDatasetRow,
  InlineParameter,
} from "@/components/parameters/InlineDatasetEditor";

/**
 * Controlled-render harness: keeps the editor's parent state inside the
 * test so we can drive the component with userEvent and assert on the
 * latest `onChange` payload via the captured ref.
 */
function Harness({
  initialParameters = [],
  initialRows = [],
  captureRef,
}: {
  initialParameters?: InlineParameter[];
  initialRows?: InlineDatasetRow[];
  captureRef?: {
    current: { parameters: InlineParameter[]; rows: InlineDatasetRow[] } | null;
  };
}) {
  const [parameters, setParameters] =
    React.useState<InlineParameter[]>(initialParameters);
  const [rows, setRows] = React.useState<InlineDatasetRow[]>(initialRows);
  const onChange: InlineDatasetEditorProps["onChange"] = ({
    parameters: next,
    rows: nextRows,
  }) => {
    setParameters(next);
    setRows(nextRows);
    if (captureRef) captureRef.current = { parameters: next, rows: nextRows };
  };
  return (
    <InlineDatasetEditor
      parameters={parameters}
      rows={rows}
      onChange={onChange}
    />
  );
}

describe("InlineDatasetEditor", () => {
  it("renders empty-state copy when no parameters are present", () => {
    render(<Harness />);
    expect(screen.getByText("No parameters yet")).toBeInTheDocument();
    // Dataset section shows the "no params" empty state, not the row empty
    expect(screen.getByText("Add a parameter first")).toBeInTheDocument();
  });

  it("disables the Add row button when there are no parameters", () => {
    render(<Harness />);
    expect(screen.getByTestId("inline-dataset-add-row")).toBeDisabled();
  });

  it("addParameter creates a row with auto-named 'param', then 'param2', 'param3' on subsequent clicks", async () => {
    const captured = { current: null as any };
    render(<Harness captureRef={captured} />);
    const addBtn = screen.getByTestId("inline-dataset-add-parameter");
    await userEvent.click(addBtn);
    expect(captured.current.parameters).toEqual([
      {
        name: "param",
        type: "STRING",
        required: false,
        sensitive: false,
      },
    ]);
    await userEvent.click(addBtn);
    expect(
      captured.current.parameters.map((p: InlineParameter) => p.name)
    ).toEqual(["param", "param2"]);
  });

  it("renameParameter cascades into row values so typo-fixes don't lose data", async () => {
    const captured = { current: null as any };
    render(
      <Harness
        captureRef={captured}
        initialParameters={[{ name: "username", type: "STRING" }]}
        initialRows={[
          { rowIndex: 0, label: "happy", values: { username: "alice" } },
        ]}
      />
    );
    const nameInput = screen.getByTestId("inline-dataset-parameter-name-0");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "user");
    expect(captured.current.parameters[0].name).toBe("user");
    expect(captured.current.rows[0].values).toEqual({ user: "alice" });
    expect(captured.current.rows[0].values).not.toHaveProperty("username");
  });

  it("removeParameter drops the column from every row's values", async () => {
    const captured = { current: null as any };
    render(
      <Harness
        captureRef={captured}
        initialParameters={[
          { name: "a", type: "STRING" },
          { name: "b", type: "STRING" },
        ]}
        initialRows={[
          { rowIndex: 0, values: { a: "x", b: "y" } },
          { rowIndex: 1, values: { a: "z", b: "w" } },
        ]}
      />
    );
    await userEvent.click(
      screen.getByTestId("inline-dataset-remove-parameter-0")
    );
    expect(captured.current.parameters).toEqual([
      { name: "b", type: "STRING" },
    ]);
    expect(captured.current.rows).toEqual([
      { rowIndex: 0, values: { b: "y" } },
      { rowIndex: 1, values: { b: "w" } },
    ]);
  });

  it("flags duplicate parameter names with the destructive error message", async () => {
    const captured = { current: null as any };
    render(
      <Harness
        captureRef={captured}
        initialParameters={[
          { name: "x", type: "STRING" },
          { name: "y", type: "STRING" },
        ]}
      />
    );
    const second = screen.getByTestId("inline-dataset-parameter-name-1");
    await userEvent.clear(second);
    await userEvent.type(second, "x");
    expect(captured.current.parameters[1].name).toBe("x");
    expect(screen.getAllByText("Duplicate name").length).toBeGreaterThan(0);
  });

  it("addRow seeds blank values keyed by parameter name, BOOLEAN defaulting to false", async () => {
    const captured = { current: null as any };
    render(
      <Harness
        captureRef={captured}
        initialParameters={[
          { name: "user", type: "STRING" },
          { name: "active", type: "BOOLEAN" },
          { name: "score", type: "INTEGER" },
        ]}
      />
    );
    await userEvent.click(screen.getByTestId("inline-dataset-add-row"));
    expect(captured.current.rows).toHaveLength(1);
    expect(captured.current.rows[0].values).toEqual({
      user: "",
      active: false,
      score: "",
    });
  });

  it("INTEGER cell coerces numeric input via Number() and preserves empty string for clears", async () => {
    const captured = { current: null as any };
    render(
      <Harness
        captureRef={captured}
        initialParameters={[{ name: "score", type: "INTEGER" }]}
        initialRows={[{ rowIndex: 0, values: { score: "" } }]}
      />
    );
    const cell = screen.getByTestId("inline-dataset-row-0-col-0");
    await userEvent.type(cell, "42");
    expect(captured.current.rows[0].values.score).toBe(42);
    await userEvent.clear(cell);
    expect(captured.current.rows[0].values.score).toBe("");
  });

  it("BOOLEAN cell renders a switch and toggles between true and false", async () => {
    const captured = { current: null as any };
    render(
      <Harness
        captureRef={captured}
        initialParameters={[{ name: "active", type: "BOOLEAN" }]}
        initialRows={[{ rowIndex: 0, values: { active: false } }]}
      />
    );
    const cell = screen.getByTestId("inline-dataset-row-0-col-0");
    await userEvent.click(cell);
    expect(captured.current.rows[0].values.active).toBe(true);
    await userEvent.click(cell);
    expect(captured.current.rows[0].values.active).toBe(false);
  });

  it("removeRow drops only the targeted row, leaving siblings intact", async () => {
    const captured = { current: null as any };
    render(
      <Harness
        captureRef={captured}
        initialParameters={[{ name: "a", type: "STRING" }]}
        initialRows={[
          { rowIndex: 0, label: "keep", values: { a: "x" } },
          { rowIndex: 1, label: "drop", values: { a: "y" } },
          { rowIndex: 2, label: "keep too", values: { a: "z" } },
        ]}
      />
    );
    await userEvent.click(screen.getByTestId("inline-dataset-remove-row-1"));
    expect(captured.current.rows).toHaveLength(2);
    expect(captured.current.rows.map((r: InlineDatasetRow) => r.label)).toEqual(
      ["keep", "keep too"]
    );
  });

  it("renders the parameter name as the dataset column header", () => {
    render(
      <Harness
        initialParameters={[
          { name: "username", type: "STRING" },
          { name: "balance", type: "INTEGER" },
        ]}
        initialRows={[{ rowIndex: 0, values: { username: "", balance: "" } }]}
      />
    );
    // Headers should include both parameter names
    const headers = screen.getAllByRole("columnheader");
    const headerTexts = headers.map((h) => h.textContent?.trim());
    expect(headerTexts).toContain("username");
    expect(headerTexts).toContain("balance");
  });

  it("uses a test-id prefix override when provided so two editors can co-exist", () => {
    render(
      <InlineDatasetEditor
        parameters={[]}
        rows={[]}
        onChange={() => {}}
        testIdPrefix="alt"
      />
    );
    expect(screen.getByTestId("alt-root")).toBeInTheDocument();
    expect(screen.getByTestId("alt-add-parameter")).toBeInTheDocument();
  });
});
