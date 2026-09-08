import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslations } from "next-intl";
import React from "react";

interface PaginationInfoProps {
  startIndex: number;
  endIndex: number;
  totalRows: number;
  searchString: string;
  pageSize: number | "All";
  pageSizeOptions: (number | "All")[];
  handlePageSizeChange: (size: number | "All") => void;
  /** When true, drop the "/Page Size" suffix and the "Showing …" / "Items"
   * labels so the controls fit a narrow list pane. */
  compact?: boolean;
}

const PaginationInfo: React.FC<PaginationInfoProps> = ({
  startIndex,
  endIndex,
  totalRows,
  searchString,
  pageSize,
  pageSizeOptions,
  handlePageSizeChange,
  compact = false,
}) => {
  const t = useTranslations("common.pagination");
  const tCommon = useTranslations("common");
  return (
    totalRows > 0 && (
      <div className="flex items-center justify-center text-sm text-muted-foreground">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="link" className="-m-2">
              {totalRows <= 10 || pageSize === "All" || pageSize === totalRows
                ? t("all")
                : compact
                  ? t("entries", { count: pageSize })
                  : `${t("entries", { count: pageSize })}/${t("pageSize")}`}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>{t("pageSize")}</DropdownMenuLabel>
            <DropdownMenuGroup>
              {pageSizeOptions.map((size) => (
                <DropdownMenuItem
                  key={size.toString()}
                  onClick={() => handlePageSizeChange(size)}
                >
                  {size === "All" ? t("all") : size.toString()}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {/* <Separator orientation="vertical" className="px-2" /> */}
        <div className=" whitespace-nowrap gap-1" data-testid="pagination-info">
          {compact
            ? `${startIndex}-${endIndex} ${tCommon("of")} ${totalRows}`
            : `${t("showing")} ${startIndex}-${endIndex} ${tCommon("of")} ${t(
                "entries",
                { count: totalRows }
              )}`}
          {searchString
            ? ` ${t("filtered")} ${t("total", { count: totalRows })}`
            : ""}
        </div>
      </div>
    )
  );
};

export { PaginationInfo };
