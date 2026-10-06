import { type ColumnDef } from "@/components/tables/tableFeatures";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "~/test/test-utils";
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

const sortableItemProps = vi.hoisted(() => [] as any[]);

vi.mock("./SortableItem", () => ({
  default: (props: any) => {
    sortableItemProps.push(props);
    return (
      <tr data-testid={`sortable-row-${props.row.original.id}`}>
        <td>{props.row.original.name}</td>
      </tr>
    );
  },
}));

interface RowShape {
  id: number;
  name: string;
}

const columns: ColumnDef<RowShape, any>[] = [
  {
    id: "name",
    accessorKey: "name",
    header: "Name",
    cell: ({ getValue }) => String(getValue()),
  },
];

const data: RowShape[] = [{ id: 1, name: "Alpha" }];

function renderTable(props: Partial<React.ComponentProps<typeof DataTable>>) {
  return render(
    <DataTable
      columns={columns}
      data={data}
      columnVisibility={{}}
      onColumnVisibilityChange={vi.fn()}
      onSortChange={vi.fn()}
      onReorder={vi.fn()}
      {...(props as any)}
    />
  );
}

/**
 * A sorted repository list keeps its rows draggable (to folders) while
 * refusing drops back into itself. The table expresses that as two flags.
 */
describe("DataTable drag vs reorder", () => {
  it("renders plain rows when neither drag nor reorder is enabled", () => {
    sortableItemProps.length = 0;
    renderTable({});

    expect(screen.getByTestId("case-row-1")).toBeInTheDocument();
    expect(screen.queryByTestId("sortable-row-1")).toBeNull();
  });

  it("renders draggable rows that accept reorder drops when reordering is on", () => {
    sortableItemProps.length = 0;
    renderTable({ enableReorder: true });

    expect(screen.getByTestId("sortable-row-1")).toBeInTheDocument();
    expect(sortableItemProps.at(-1).canReorder).toBe(true);
  });

  it("renders draggable rows that refuse reorder drops when only drag is on", () => {
    sortableItemProps.length = 0;
    renderTable({ enableDrag: true, enableReorder: false });

    expect(screen.getByTestId("sortable-row-1")).toBeInTheDocument();
    expect(sortableItemProps.at(-1).canReorder).toBe(false);
  });
});
