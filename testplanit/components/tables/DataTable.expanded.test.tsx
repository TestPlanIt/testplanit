import {
  type ColumnDef,
  type ExpandedState,
} from "@/components/tables/tableFeatures";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "~/test/test-utils";
import { DataTable } from "./DataTable";

vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));

interface RowShape {
  id: number;
  name: string;
  subRows?: RowShape[];
}

const columns: ColumnDef<RowShape, any>[] = [
  {
    id: "name",
    accessorKey: "name",
    header: "Name",
    cell: ({ getValue }) => String(getValue()),
  },
];

function makeData(): RowShape[] {
  return [
    {
      id: 1,
      name: "Parent",
      subRows: [{ id: 11, name: "Child" }],
    },
  ];
}

/**
 * Mirrors the admin Categories table: expansion is controlled by the page and
 * rows are keyed by id, so a refetch that hands the table a new array must not
 * collapse what the user opened.
 */
function ControlledHarness({ data }: { data: RowShape[] }) {
  const [expanded, setExpanded] = React.useState<ExpandedState>({});
  return (
    <DataTable
      columns={columns}
      data={data}
      getSubRows={(row: RowShape) => row.subRows}
      getRowId={(row: RowShape) => String(row.id)}
      expanded={expanded}
      onExpandedChange={setExpanded}
      columnVisibility={{}}
      onColumnVisibilityChange={vi.fn()}
      onSortChange={vi.fn()}
    />
  );
}

function UncontrolledHarness({ data }: { data: RowShape[] }) {
  return (
    <DataTable
      columns={columns}
      data={data}
      getSubRows={(row: RowShape) => row.subRows}
      getRowId={(row: RowShape) => String(row.id)}
      columnVisibility={{}}
      onColumnVisibilityChange={vi.fn()}
      onSortChange={vi.fn()}
    />
  );
}

/**
 * A table whose rows carry per-row DETAIL rather than sub-rows, with the
 * selection column every such table leads with.
 */
function DetailHarness() {
  const [expanded, setExpanded] = React.useState<ExpandedState>({});
  return (
    <DataTable
      columns={[
        { id: "select", header: "", cell: () => "x", size: 40 },
        ...columns,
      ]}
      data={[{ id: 1, name: "Parent" }]}
      getRowId={(row: RowShape) => String(row.id)}
      expanded={expanded}
      onExpandedChange={setExpanded}
      renderExpandedRow={(row: RowShape) => (
        <div data-testid={`detail-${row.id}`}>why {row.name} matters</div>
      )}
      columnVisibility={{}}
      onColumnVisibilityChange={vi.fn()}
      onSortChange={vi.fn()}
    />
  );
}

describe("DataTable detail rows", () => {
  it("opens a full-width row under the row it belongs to", () => {
    render(<DetailHarness />);

    // A row with no sub-rows still gets a chevron when detail is wired.
    expect(screen.queryByTestId("detail-1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("row-expander"));

    expect(screen.getByTestId("detail-1")).toBeInTheDocument();
    const detailCell = screen
      .getByTestId("case-row-1-detail")
      .querySelector("td");
    expect(detailCell?.getAttribute("colspan")).toBe("2");

    fireEvent.click(screen.getByTestId("row-expander"));
    expect(screen.queryByTestId("detail-1")).not.toBeInTheDocument();
  });

  it("keeps the row itself in place when it opens", () => {
    render(<DetailHarness />);

    const row = screen.getByTestId("case-row-1");
    const expander = screen.getByTestId<HTMLButtonElement>("row-expander");
    expander.focus();
    fireEvent.click(expander);

    // A row whose element type changed on toggle would be deleted and rebuilt:
    // the chevron the user just pressed loses focus and its rotation remounts
    // already-rotated instead of animating.
    expect(screen.getByTestId("case-row-1")).toBe(row);
    expect(screen.getByTestId("row-expander")).toBe(expander);
    expect(document.activeElement).toBe(expander);
    expect(expander.getAttribute("aria-expanded")).toBe("true");
  });

  it("indents the detail onto a child row's text origin", () => {
    render(<DetailHarness />);
    fireEvent.click(screen.getByTestId("row-expander"));

    // The select column (50px — `size: 40` clamps to the 50px default
    // minimum) + 8px cell padding + the 20px chevron slot + one 24px nesting
    // level, i.e. where a sub-row of this row would start its text.
    const cell = screen
      .getByTestId("case-row-1-detail")
      .querySelector("td") as HTMLTableCellElement;
    expect(cell.style.paddingInlineStart).toBe("102px");
  });

  it("leads the first content cell, not the selection well", () => {
    render(<DetailHarness />);

    const cells = screen.getByTestId("case-row-1").querySelectorAll("td");
    expect(cells[0].getAttribute("data-column-id")).toBe("select");
    expect(cells[0].querySelector('[data-testid="row-expander"]')).toBeNull();
    expect(
      cells[1].querySelector('[data-testid="row-expander"]')
    ).not.toBeNull();
  });
});

describe("DataTable expansion across data changes", () => {
  it("keeps a controlled expanded row open when the data array is replaced", async () => {
    const { rerender } = render(<ControlledHarness data={makeData()} />);

    expect(screen.queryByTestId("case-row-11")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("row-expander"));
    expect(screen.getByTestId("case-row-11")).toBeInTheDocument();

    // A refetch produces a new array with the same rows.
    await act(async () => {
      rerender(<ControlledHarness data={makeData()} />);
    });
    await act(async () => {});

    expect(screen.getByTestId("case-row-11")).toBeInTheDocument();
  });

  it("keeps an internally expanded row open when the data array is replaced", async () => {
    const { rerender } = render(<UncontrolledHarness data={makeData()} />);

    fireEvent.click(screen.getByTestId("row-expander"));
    expect(screen.getByTestId("case-row-11")).toBeInTheDocument();

    await act(async () => {
      rerender(<UncontrolledHarness data={makeData()} />);
    });
    await act(async () => {});

    expect(screen.getByTestId("case-row-11")).toBeInTheDocument();
  });
});
