import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { WorkflowStateDisplay } from "@/components/WorkflowStateDisplay";
import { XIcon, AlertCircle } from "lucide-react";
import { IconName } from "~/types/globals";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toHumanReadable } from "~/utils/duration";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { RepositoryCaseSource } from "@prisma/client";
import { Label } from "@/components/ui/label";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import LoadingSpinner from "@/components/LoadingSpinner";

interface SelectedTestCasesDrawerProps {
  selectedTestCases: number[];
  onSelectionChange: (selectedIds: number[]) => void;
  projectId: number;
  trigger?: React.ReactNode;
  isEditMode?: boolean;
}

export function SelectedTestCasesDrawer({
  selectedTestCases,
  onSelectionChange,
  projectId,
  trigger,
  isEditMode = true,
}: SelectedTestCasesDrawerProps) {
  const t = useTranslations();
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);

  // Get user's preferred page size from session
  const getUserPreferredPageSize = (): number => {
    if (session?.user?.preferences?.itemsPerPage) {
      const preferredSize = parseInt(
        session.user.preferences.itemsPerPage.replace("P", ""),
        10
      );
      if (!isNaN(preferredSize) && preferredSize > 0) {
        return preferredSize;
      }
    }
    return 50; // Default fallback
  };

  // Internal pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number | "All">(() =>
    getUserPreferredPageSize()
  );

  // Page size options
  const pageSizeOptions: (number | "All")[] = [25, 50, 100, 250];

  // Calculate pagination values
  const totalItems = selectedTestCases.length;
  const effectivePageSize = pageSize === "All" ? totalItems : pageSize;
  const totalPages = Math.max(1, Math.ceil(totalItems / effectivePageSize));
  const startIndex = (currentPage - 1) * effectivePageSize + 1;
  const endIndex = Math.min(currentPage * effectivePageSize, totalItems);

  // Fetched test cases data
  const [fetchedTestCases, setFetchedTestCases] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Reset to page 1 if current page is out of bounds
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [currentPage, totalPages]);

  // Fetch test cases for current page
  useEffect(() => {
    // Only fetch when drawer is open and there are selected test cases
    if (!open || selectedTestCases.length === 0) {
      return;
    }

    const fetchTestCases = async () => {
      setIsLoading(true);
      try {
        const skip = (currentPage - 1) * effectivePageSize;
        const take = effectivePageSize;

        const response = await fetch(
          `/api/projects/${projectId}/cases/fetch-many`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              caseIds: selectedTestCases,
              skip,
              take,
            }),
          }
        );

        if (!response.ok) {
          throw new Error("Failed to fetch test cases");
        }

        const data = await response.json();
        setFetchedTestCases(data.cases || []);
      } catch (error) {
        console.error("Error fetching test cases:", error);
        setFetchedTestCases([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTestCases();
  }, [selectedTestCases, open, projectId, currentPage, effectivePageSize]);

  const handlePageSizeChange = (newSize: number | "All") => {
    setPageSize(newSize);
    setCurrentPage(1); // Reset to first page when changing page size
  };

  const renderTestCaseItem = (
    testCase: (typeof fetchedTestCases)[0],
    globalIndex: number
  ) => {
    return (
      <div
        key={testCase.id}
        className="w-full hover:bg-accent rounded-md pb-2 group"
      >
        <div className="flex items-start w-full px-2 pt-1 group">
          {/* Index column */}
          <div className="shrink-0 w-8 text-right text-muted-foreground text-sm">
            {globalIndex}
          </div>
          {/* Name column */}
          <div className="flex-1 min-w-0 ml-2">
            <CaseDisplay
              id={testCase.id}
              name={testCase.name}
              source={testCase.source || RepositoryCaseSource.MANUAL}
              maxLines={2}
            />
          </div>
          {/* Workflow state column */}
          <div className="shrink-0 w-24 flex items-center justify-start ml-2">
            {testCase.state.icon &&
            testCase.state.icon.name &&
            testCase.state.color &&
            testCase.state.color.value ? (
              <WorkflowStateDisplay
                size="sm"
                state={{
                  name: testCase.state.name,
                  icon: {
                    name: testCase.state.icon.name as IconName,
                  },
                  color: {
                    value: testCase.state.color.value,
                  },
                }}
              />
            ) : (
              <span className="text-sm text-muted-foreground truncate">
                {testCase.state.name}
              </span>
            )}
          </div>
          {/* Remove button column */}
          {isEditMode && (
            <div className="shrink-0 w-10 flex justify-end items-center ml-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  onSelectionChange(
                    selectedTestCases.filter((id) => id !== testCase.id)
                  );
                }}
              >
                <XIcon className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
        {(typeof testCase.estimate === "number" ||
          testCase.estimate === null ||
          typeof testCase.forecastManual === "number" ||
          testCase.forecastManual === null ||
          typeof testCase.forecastAutomated === "number" ||
          testCase.forecastAutomated === null) && (
          <div className="w-full pl-10 pb-1 text-xs text-muted-foreground flex flex-row items-center group divide-x divide-current">
            {(() => {
              const elements = [];
              if (typeof testCase.estimate === "number") {
                elements.push(
                  <span key="estimate" className="py-1">
                    <Label className="mr-1 text-xs">
                      {t("repository.fields.estimate")}:
                    </Label>
                    <span>
                      {toHumanReadable(testCase.estimate, {
                        isSeconds: true,
                      })}
                    </span>
                  </span>
                );
              }
              if (typeof testCase.forecastManual === "number") {
                elements.push(
                  <span key="forecastManual" className="py-1">
                    <Label className="mr-1 text-xs">
                      {t("common.fields.forecastManual")}:
                    </Label>
                    <span>
                      {toHumanReadable(testCase.forecastManual, {
                        isSeconds: true,
                      })}
                    </span>
                  </span>
                );
              }
              if (typeof testCase.forecastAutomated === "number") {
                elements.push(
                  <span key="forecastAutomated" className="py-1">
                    <Label className="mr-1 text-xs">
                      {t("common.fields.forecastAutomated")}:
                    </Label>
                    <span>
                      {toHumanReadable(testCase.forecastAutomated, {
                        isSeconds: true,
                        round: false,
                      })}
                    </span>
                  </span>
                );
              }
              return elements.map((el, idx) => (
                <div
                  key={idx}
                  className={`
                    ${idx === 0 ? "pr-2" : "px-2"}
                    ${idx === elements.length - 1 ? "pl-2" : "px-2"}
                  `}
                >
                  {el}
                </div>
              ));
            })()}
          </div>
        )}
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger || (
          <Button size="lg">
            <Badge variant="outline" className="text-primary-background">
              {selectedTestCases.length}
            </Badge>
            {t("common.labels.selectedTestCases")}
          </Button>
        )}
      </SheetTrigger>
      <SheetContent className="h-full p-0 sm:max-w-4xl">
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b p-4">
            <SheetTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span>{t("common.labels.selectedTestCases")}</span>
                <Badge variant="secondary">{selectedTestCases.length}</Badge>
                {isEditMode && selectedTestCases.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onSelectionChange([])}
                  >
                    {t("common.actions.clear")}
                  </Button>
                )}
              </div>
              {!isEditMode && (
                <div>
                  <Alert className="mb-4 items-center">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>
                      {t("common.labels.editToModifyCasesTitle")}
                    </AlertTitle>
                    <AlertDescription>
                      {t("common.labels.editToModifyCases")}
                    </AlertDescription>
                  </Alert>
                </div>
              )}
            </SheetTitle>
          </SheetHeader>

          {/* Pagination info */}
          {totalItems > 0 && (
            <div className="border-b px-4 py-2">
              <PaginationInfo
                startIndex={startIndex}
                endIndex={endIndex}
                totalRows={totalItems}
                searchString=""
                pageSize={pageSize}
                pageSizeOptions={pageSizeOptions}
                handlePageSizeChange={handlePageSizeChange}
              />
            </div>
          )}

          {/* Test cases list */}
          <div className="flex-1 overflow-y-auto p-4">
            {selectedTestCases.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">
                {t("common.labels.noTestCasesSelected")}
              </div>
            ) : isLoading ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : (
              <div className="space-y-2">
                {fetchedTestCases.map((testCase, index) => {
                  const globalIndex =
                    (currentPage - 1) * effectivePageSize + index + 1;
                  return renderTestCaseItem(testCase, globalIndex);
                })}
              </div>
            )}
          </div>

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="border-t p-4 flex justify-center">
              <PaginationComponent
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
              />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
