import { Column } from "@tanstack/react-table";
import { ArrowDownUp } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DataTableColumnHeaderProps<TData, TValue> {
  column: Column<TData, TValue>;
  title: string;
  children?: React.ReactNode;
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  children,
}: DataTableColumnHeaderProps<TData, TValue>) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        <span>{title}</span>
        {children}
      </div>
    </div>
  );
}
