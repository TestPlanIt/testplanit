"use client";

import type { RowData } from "@tanstack/react-table";
import type { ComponentPropsWithoutRef } from "react";

import { Checkbox } from "@/components/ui/checkbox";

import { rowRange } from "~/hooks/useRangeSelect";

import type { Row, Table } from "./tableFeatures";

/**
 * The row each table last ticked: where a shift-click range starts. Keyed by
 * the table's store, the one part of a table that survives a re-render.
 */
const anchors = new WeakMap<object, string>();

type CheckboxProps = Omit<
  ComponentPropsWithoutRef<typeof Checkbox>,
  "checked" | "onCheckedChange" | "onClick"
>;

/**
 * The checkbox in a table's select column. A click ticks or clears its row;
 * a shift-click also selects every row between it and the row last ticked,
 * as the repository cases table does.
 */
export function RowSelectCheckbox<TData extends RowData>({
  row,
  table,
  ...props
}: CheckboxProps & { row: Row<TData>; table: Table<TData> }) {
  return (
    <Checkbox
      {...props}
      checked={row.getIsSelected()}
      onCheckedChange={(value) => {
        const selected = value === true;
        row.toggleSelected(selected);
        if (selected) anchors.set(table.store, row.id);
      }}
      onClick={(event) => {
        event.stopPropagation();
        const anchor = anchors.get(table.store);
        if (!event.shiftKey || !anchor || anchor === row.id) return;
        const rows = table.getRowModel().rows;
        const range = rowRange(
          rows.map((candidate) => candidate.id),
          anchor,
          row.id
        );
        if (!range) return;
        // The range replaces the ordinary toggle of the clicked row.
        event.preventDefault();
        const selectable = new Set(
          rows.filter((candidate) => candidate.getCanSelect()).map((c) => c.id)
        );
        table.setRowSelection((current) => {
          const next = { ...current };
          for (const id of range) if (selectable.has(id)) next[id] = true;
          return next;
        });
        anchors.set(table.store, row.id);
      }}
      // Shift-click would otherwise select the text between the two rows.
      onMouseDown={(event) => {
        if (event.shiftKey) event.preventDefault();
      }}
    />
  );
}
