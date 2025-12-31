import React, { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

const PaginationComponent: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  onPageChange,
}) => {
  const [selectedPage, setSelectedPage] = useState<string>("");
  const t = useTranslations("common.pagination");

  if (totalPages < 2) return null;

  const handlePageSelect = (page: string) => {
    const newPage = Number(page);
    onPageChange(newPage); // Notify the parent component about the page change.
  };

  const generatePageRange = (start: number, end: number) => {
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  };

  const renderEllipsisDropdown = (pageNumbers: number[]) => {
    return (
      <Select value={selectedPage} onValueChange={handlePageSelect}>
        <SelectTrigger aria-label={t("selectPage")}>
          <SelectValue placeholder={<PaginationEllipsis />} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {pageNumbers.map((pageNum) => (
              <SelectItem key={pageNum} value={`${pageNum}`}>
                {pageNum}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    );
  };

  const renderPaginationItems = () => {
    const items = [];
    const isFirstPage = currentPage === 1;
    const isLastPage = currentPage === totalPages;
    const delta = 1; // Controls the number of pages around the current page
    const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);

    items.push(
      <PaginationItem key="prev">
        <PaginationPrevious
          href="#"
          onClick={(e: any) => {
            e.preventDefault();
            if (!isFirstPage) onPageChange(currentPage - 1);
          }}
          aria-disabled={isFirstPage ? "true" : undefined}
          tabIndex={isFirstPage ? -1 : undefined}
          className={`px-2 py-1 h-auto ${isFirstPage ? "pointer-events-none opacity-50" : ""}`}
          aria-label={t("goToPrevious")}
        />
      </PaginationItem>
    );

    for (let i = 1; i <= totalPages; i++) {
      if (
        i === 1 ||
        i === totalPages ||
        (i >= currentPage - delta && i <= currentPage + delta)
      ) {
        items.push(
          <PaginationItem key={i}>
            <PaginationLink
              href="#"
              onClick={(e: any) => {
                e.preventDefault();
                onPageChange(i);
              }}
              isActive={currentPage === i}
              className={`px-2 py-1 h-auto ${
                currentPage === i
                  ? "text-primary-foreground no-underline bg-primary/50 pointer-events-none text-primary-background"
                  : "hover:bg-primary/50 hover:text-accent-foreground"
              }`}
            >
              {i}
            </PaginationLink>
          </PaginationItem>
        );
      } else if (i === currentPage - delta - 1) {
        const hiddenPageNumbersBeforeCurrent = generatePageRange(
          2,
          currentPage - delta - 1
        );
        items.push(
          <PaginationItem key="start-ellipsis">
            {renderEllipsisDropdown(hiddenPageNumbersBeforeCurrent)}
          </PaginationItem>
        );
      } else if (i === currentPage + delta + 1 && i < totalPages) {
        const hiddenPageNumbersAfterCurrent = generatePageRange(
          currentPage + delta + 1,
          totalPages - 1
        );
        items.push(
          <PaginationItem key="end-ellipsis">
            {renderEllipsisDropdown(hiddenPageNumbersAfterCurrent)}
          </PaginationItem>
        );
      }
    }

    items.push(
      <PaginationItem key="next">
        <PaginationNext
          href="#"
          onClick={(e: any) => {
            e.preventDefault();
            if (!isLastPage) onPageChange(currentPage + 1);
          }}
          aria-disabled={isLastPage ? "true" : undefined}
          tabIndex={isLastPage ? -1 : undefined}
          className={`px-2 py-1 h-auto ${isLastPage ? "pointer-events-none opacity-50" : ""}`}
          aria-label={t("goToNext")}
        />
      </PaginationItem>
    );

    return items;
  };

  return (
    <Pagination>
      <PaginationContent className="pt-1">
        {renderPaginationItems()}
      </PaginationContent>
    </Pagination>
  );
};

export { PaginationComponent };
