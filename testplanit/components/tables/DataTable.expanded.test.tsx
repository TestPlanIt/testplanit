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
