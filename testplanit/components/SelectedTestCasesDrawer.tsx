import LoadingSpinner from "@/components/LoadingSpinner";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { WorkflowStateDisplay } from "@/components/WorkflowStateDisplay";
import { RepositoryCaseSource } from "~/zenstack/models";
import { AlertCircle, XIcon } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { usePageSizeOptions } from "~/hooks/usePageSizeOptions";
import { IconName } from "~/types/globals";
import { cn } from "~/utils";
import { toHumanReadable } from "~/utils/duration";

interface SelectedTestCasesDrawerProps {
  selectedTestCases: number[];
  onSelectionChange: (selectedIds: number[]) => void;
  projectId: number;
  trigger?: React.ReactNode;
  isEditMode?: boolean;
  useCheckboxes?: boolean; // Use checkboxes instead of remove buttons for selection
  allAvailableCases?: number[]; // When using checkboxes, this is the full list to display (selected + unselected)
}

export function SelectedTestCasesDrawer({
  selectedTestCases,
  onSelectionChange,
  projectId,
  trigger,
  isEditMode = true,
  useCheckboxes = false,
  allAvailableCases,
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

  // When using checkboxes with allAvailableCases, display those instead of just selected
  const casesToDisplay =
    useCheckboxes && allAvailableCases ? allAvailableCases : selectedTestCases;

  // Calculate pagination values
  const totalItems = casesToDisplay.length;
  const effectivePageSize = pageSize === "All" ? totalItems : pageSize;
  const totalPages = Math.max(1, Math.ceil(totalItems / effectivePageSize));
  const startIndex = (currentPage - 1) * effectivePageSize + 1;
  const endIndex = Math.min(currentPage * effectivePageSize, totalItems);
  const pageSizeOptions = usePageSizeOptions(totalItems);

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
    // Only fetch when drawer is open and there are cases to display
    if (!open || casesToDisplay.length === 0) {
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
              caseIds: casesToDisplay,
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

    void fetchTestCases();
  }, [casesToDisplay, open, projectId, currentPage, effectivePageSize]);

  const handlePageSizeChange = (newSize: number | "All") => {
    setPageSize(newSize);
    setCurrentPage(1); // Reset to first page when changing page size
  };

  const renderTestCaseItem = (
    testCase: (typeof fetchedTestCases)[0],
    globalIndex: number
  ) => {
    const isSelected = selectedTestCases.includes(testCase.id);

    const handleToggle = () => {
      if (isSelected) {
        onSelectionChange(selectedTestCases.filter((id) => id !== testCase.id));
      } else {
        onSelectionChange([...selectedTestCases, testCase.id]);
      }
    };

    const hasEstimates =
      typeof testCase.estimate === "number" ||
      typeof testCase.forecastManual === "number" ||
      typeof testCase.forecastAutomated === "number";

    return (
      <div
        key={testCase.id}
        className={cn(
          "px-3 py-1 border-b border-border/60 last:border-b-0 text-sm hover:bg-muted/40",
          useCheckboxes && !isSelected && "opacity-50"
        )}
      >
        <div className="flex items-center gap-2 min-h-8 min-w-0">
          {/* Checkbox column (when using checkboxes) */}
          {isEditMode && useCheckboxes ? (
            <div className="shrink-0 w-6 flex items-center justify-center">
              <Checkbox
                checked={isSelected}
                onCheckedChange={handleToggle}
                aria-label={`Select ${testCase.name}`}
              />
            </div>
          ) : (
            /* Index column (when not using checkboxes) */
            <div className="shrink-0 w-6 text-end text-muted-foreground text-xs">
              {globalIndex}
            </div>
          )}
          {/* Name column */}
          <div className="flex-1 min-w-0">
            <CaseDisplay
              id={testCase.id}
              name={testCase.name}
              source={testCase.source || RepositoryCaseSource.MANUAL}
              automated={testCase.automated}
              hasParameters={testCase.hasParameters}
              size="medium"
              maxLines={1}
              link={`/projects/repository/${projectId}/${testCase.id}`}
              linkTarget="_blank"
            />
          </div>
          {/* Workflow state column */}
          <div className="shrink-0 w-24 flex items-center justify-end">
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
              <span className="text-xs text-muted-foreground truncate">
                {testCase.state.name}
              </span>
            )}
          </div>
          {/* Remove button column (when not using checkboxes) */}
          {isEditMode && !useCheckboxes && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
              aria-label={t("common.actions.remove")}
              onClick={() => {
                onSelectionChange(
                  selectedTestCases.filter((id) => id !== testCase.id)
                );
              }}
            >
              <XIcon className="h-4 w-4" />
            </Button>
          )}
        </div>
        {/* Estimate / forecast sub-line, indented to align under the name */}
        {hasEstimates && (
          <div className="ps-8 pb-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {typeof testCase.estimate === "number" && (
              <span>
                <span className="me-1">{t("common.fields.estimate")}:</span>
                {toHumanReadable(testCase.estimate, { isSeconds: true })}
              </span>
            )}
            {typeof testCase.forecastManual === "number" && (
              <span>
                <span className="me-1">
                  {t("common.fields.forecastManual")}:
                </span>
                {toHumanReadable(testCase.forecastManual, { isSeconds: true })}
              </span>
            )}
            {typeof testCase.forecastAutomated === "number" && (
              <span>
                <span className="me-1">
                  {t("common.fields.forecastAutomated")}:
                </span>
                {toHumanReadable(testCase.forecastAutomated, {
                  isSeconds: true,
                  maxDecimalPoints: 2,
                })}
              </span>
            )}
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
          <SheetHeader className="border-b p-3">
            <SheetDescription className="sr-only">
              {t("common.labels.selectedTestCases")}
            </SheetDescription>
            <SheetTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span>
                  {t("common.labels.selectedTestCasesCount", {
                    count: selectedTestCases.length,
                  })}
                </span>
                {isEditMode && selectedTestCases.length > 0 && (
                  <Button
                    variant="outline"
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
            <div className="border-b px-3 py-2">
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
          <div className="flex-1 overflow-y-auto">
            {casesToDisplay.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-8">
                {t("common.labels.noTestCasesSelected")}
              </div>
            ) : isLoading ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : (
              <div>
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
            <div className="border-t p-3 flex justify-center">
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
