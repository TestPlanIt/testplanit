import { useTable, type RowSelectionState } from "@tanstack/react-table";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { RowSelectCheckbox } from "./RowSelectCheckbox";
import { dataTableFeatures, type ColumnDef } from "./tableFeatures";

interface Item {
  id: string;
}

const columns: ColumnDef<Item>[] = [{ id: "select" }];
const data: Item[] = ["a", "b", "c", "d", "e"].map((id) => ({ id }));

function Harness() {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const table = useTable({
    features: dataTableFeatures,
    data,
    columns,
    enableRowSelection: true,
    state: { rowSelection },
    onRowSelectionChange: setRowSelection,
    getRowId: (item: Item) => item.id,
  });
  return (
    <div>
      {table.getRowModel().rows.map((row) => (
        <div key={row.id}>
          <RowSelectCheckbox
            row={row}
            table={table}
            data-testid={`select-${row.id}`}
          />
        </div>
      ))}
      <output data-testid="selected">
        {Object.keys(rowSelection).sort().join(",")}
      </output>
    </div>
  );
}

const selected = () => screen.getByTestId("selected").textContent;

describe("RowSelectCheckbox", () => {
  it("ticks and clears a single row on a plain click", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("select-b"));
    expect(selected()).toBe("b");
    fireEvent.click(screen.getByTestId("select-b"));
    expect(selected()).toBe("");
  });

  it("selects the rows in between on a shift-click", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("select-b"));
    fireEvent.click(screen.getByTestId("select-d"), { shiftKey: true });
    expect(selected()).toBe("b,c,d");
  });

  it("extends upwards and keeps what was already selected", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("select-e"));
    fireEvent.click(screen.getByTestId("select-c"));
    fireEvent.click(screen.getByTestId("select-a"), { shiftKey: true });
    expect(selected()).toBe("a,b,c,e");
  });

  it("treats a shift-click with nothing ticked yet as a plain click", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("select-c"), { shiftKey: true });
    expect(selected()).toBe("c");
  });
});
