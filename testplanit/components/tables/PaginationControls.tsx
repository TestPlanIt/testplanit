import React from "react";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

interface PaginationInfoProps {
  startIndex: number;
  endIndex: number;
  totalRows: number;
  searchString: string;
  pageSize: number | "All";
  pageSizeOptions: (number | "All")[];
  handlePageSizeChange: (size: number | "All") => void;
}

const PaginationInfo: React.FC<PaginationInfoProps> = ({
  startIndex,
  endIndex,
  totalRows,
  searchString,
  pageSize,
  pageSizeOptions,
  handlePageSizeChange,
}) => {
  const t = useTranslations("common.pagination");
  const tCommon = useTranslations("common");
  return (
    totalRows > 0 && (
      <div className="flex items-center justify-center text-sm text-muted-foreground">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="link" className="-m-2">
              {totalRows <= 10 || pageSize === totalRows
                ? t("all")
                : `${pageSize} ${t("entries", { count: pageSize })}/${t("pageSize")}`}
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
        <div className=" whitespace-nowrap gap-1">
          {t("showing")} {startIndex + 1}-{endIndex} {t("of")} {totalRows}{" "}
          {t("entries", { count: totalRows })}
          {searchString
            ? ` ${t("filtered")} ${totalRows} ${t("total", { count: totalRows })}`
            : ""}
        </div>
      </div>
    )
  );
};

export { PaginationInfo };
