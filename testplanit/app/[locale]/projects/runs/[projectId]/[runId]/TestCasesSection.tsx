import { useTranslations } from "next-intl";
import { useState, useEffect, useRef, useMemo } from "react";
import ProjectRepository from "../../../repository/[projectId]/ProjectRepository";
import { useSearchParams, useParams } from "next/navigation";
import { useRouter, usePathname } from "~/lib/navigation";
import { CirclePlay, Combine } from "lucide-react";
import { Button } from "~/components/ui/button";
import { ConfigurationNameDisplay } from "~/components/ConfigurationNameDisplay";
import { ApplicationArea, RepositoryCaseSource } from "@prisma/client";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { useFindManyTestRuns } from "~/lib/hooks";
import { MultiAsyncCombobox } from "~/components/ui/multi-async-combobox";

// Import the TestRunWithRelations type and required related types
type WorkflowStateWithRelations = {
  id: number;
  name: string;
  order: number;
  iconId: number;
  colorId: number;
  isEnabled: boolean;
  isDeleted: boolean;
  isDefault: boolean;
  workflowType: string;
  scope: string;
  icon: {
    id: number;
    name: string;
  } | null;
  color: {
    id: number;
    order: number;
    value: string;
    colorFamilyId: number;
  } | null;
};

type TestRunWithRelations = {
  id: number;
  name: string;
  configId: number | null;
  milestoneId: number | null;
  stateId: number;
  note: any;
  docs: any;
  createdAt: Date;
  isDeleted: boolean;
  isCompleted: boolean;
  completedAt: Date | null;
  project: { id: number; name: string };
  configuration: { id: number; name: string } | null;
  configurationGroupId: string | null;
  milestone: any | null;
  state: WorkflowStateWithRelations;
  createdBy: { id: string; name: string };
  attachments: any[];
  testCases: Array<{
    id: number;
    order: number;
    repositoryCase: {
      id: number;
      name: string;
      state: WorkflowStateWithRelations;
      source?: RepositoryCaseSource;
    };
  }>;
};

// Type for sibling test run in configuration selector
type SiblingTestRun = {
  id: number;
  name: string;
  configuration: { id: number; name: string } | null;
  testCases: Array<{
    repositoryCase: {
      id: number;
    };
  }>;
};

// Type for selected configuration info to pass to parent
export type SelectedConfigurationInfo = {
  id: number;
  name: string;
  configuration: { id: number; name: string } | null;
};

// Test Cases Section Component
interface TestCasesSectionProps {
  testRunData: TestRunWithRelations | null | undefined;
  isEditMode?: boolean;
  onTestCasesChange?: (testCaseIds: number[]) => void;
  canAddEdit: boolean;
  refetchTestRun: () => void;
  onMultiConfigSelected?: (isMulti: boolean) => void;
  onSelectedConfigurationsChange?: (
    configs: SelectedConfigurationInfo[]
  ) => void;
}

export function TestCasesSection({
  testRunData,
  isEditMode = false,
  onTestCasesChange,
  canAddEdit,
  refetchTestRun,
  onMultiConfigSelected,
  onSelectedConfigurationsChange,
}: TestCasesSectionProps) {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams<{ projectId: string; runId: string }>();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedCaseId = searchParams.get("selectedCase")
    ? parseInt(searchParams.get("selectedCase")!)
    : null;

  // Parse configurations from URL
  const configurationsFromUrl = useMemo(() => {
    const configsParam = searchParams.get("configs");
    if (!configsParam) return null;
    return configsParam.split(",").map((id) => parseInt(id)).filter((id) => !isNaN(id));
  }, [searchParams]);

  const [selectedTestCases, setSelectedTestCases] = useState<number[]>(
    testRunData?.testCases.map((tc) => tc.repositoryCase.id) || []
  );
  const [isTableReady, setIsTableReady] = useState(false);
  const scrollAttempts = useRef(0);
  const maxScrollAttempts = 10; // Maximum number of attempts to scroll
  const scrollInterval = useRef<NodeJS.Timeout | null>(null);
  const hasInitializedFromUrl = useRef(false);

  // State for multi-config test run configuration selection
  const [selectedConfigurations, setSelectedConfigurations] = useState<
    SiblingTestRun[]
  >([]);

  // Fetch permissions
  const {
    permissions: testRunResultPermissions,
    isLoading: isLoadingPermissions,
  } = useProjectPermissions(params.projectId, "TestRunResults");
  const canAddEditResults = testRunResultPermissions?.canAddEdit ?? false;

  // Fetch sibling test runs for multi-config test runs
  const { data: siblingTestRunsData } = useFindManyTestRuns(
    {
      where: {
        configurationGroupId: testRunData?.configurationGroupId ?? undefined,
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        configuration: {
          select: {
            id: true,
            name: true,
          },
        },
        testCases: {
          select: {
            repositoryCase: {
              select: {
                id: true,
              },
            },
          },
        },
      },
      orderBy: {
        configuration: {
          name: "asc",
        },
      },
    },
    {
      enabled: !!testRunData?.configurationGroupId,
    }
  );

  // Transform the data to match our SiblingTestRun type
  const siblingTestRuns: SiblingTestRun[] = useMemo(() => {
    if (!siblingTestRunsData) return [];
    return siblingTestRunsData.map((run) => ({
      id: run.id,
      name: run.name,
      configuration: run.configuration,
      testCases: run.testCases,
    }));
  }, [siblingTestRunsData]);

  // Initialize selected configurations from URL or default to current test run
  useEffect(() => {
    if (
      siblingTestRuns.length > 0 &&
      testRunData &&
      selectedConfigurations.length === 0 &&
      !hasInitializedFromUrl.current
    ) {
      hasInitializedFromUrl.current = true;

      // If URL has configs param, use those
      if (configurationsFromUrl && configurationsFromUrl.length > 0) {
        const configsFromUrl = siblingTestRuns.filter((run) =>
          configurationsFromUrl.includes(run.id)
        );
        if (configsFromUrl.length > 0) {
          setSelectedConfigurations(configsFromUrl);
          return;
        }
      }

      // Default to current test run
      const currentRun = siblingTestRuns.find(
        (run) => run.id === testRunData.id
      );
      if (currentRun) {
        setSelectedConfigurations([currentRun]);
      }
    }
  }, [siblingTestRuns, testRunData, selectedConfigurations.length, configurationsFromUrl]);

  // Compute the selected run IDs for multi-config runs
  const selectedRunIds = useMemo(() => {
    if (
      !testRunData?.configurationGroupId ||
      selectedConfigurations.length === 0
    ) {
      // Not a multi-config run or no configurations selected, use current run only
      return testRunData ? [testRunData.id] : [];
    }
    return selectedConfigurations.map((run) => run.id);
  }, [testRunData, selectedConfigurations]);

  // Compute the combined test cases count from all selected configurations (for display)
  const combinedTestCasesCount = useMemo(() => {
    if (
      !testRunData?.configurationGroupId ||
      selectedConfigurations.length === 0
    ) {
      return testRunData?.testCases.length || 0;
    }
    // Sum up test cases from all selected configurations
    return selectedConfigurations.reduce(
      (total, run) => total + run.testCases.length,
      0
    );
  }, [testRunData, selectedConfigurations]);

  // Compute the unique test cases count across all selected configurations
  const uniqueTestCasesCount = useMemo(() => {
    if (
      !testRunData?.configurationGroupId ||
      selectedConfigurations.length <= 1
    ) {
      return testRunData?.testCases.length || 0;
    }
    // Get unique repository case IDs across all selected configurations
    const uniqueCaseIds = new Set<number>();
    selectedConfigurations.forEach((run) => {
      run.testCases.forEach((tc) => {
        uniqueCaseIds.add(tc.repositoryCase.id);
      });
    });
    return uniqueCaseIds.size;
  }, [testRunData, selectedConfigurations]);

  // Check if this is a multi-config test run
  const isMultiConfigRun =
    !!testRunData?.configurationGroupId && (siblingTestRuns?.length || 0) > 1;

  // Notify parent when multiple configurations are selected
  useEffect(() => {
    if (onMultiConfigSelected) {
      onMultiConfigSelected(selectedConfigurations.length > 1);
    }
  }, [selectedConfigurations.length, onMultiConfigSelected]);

  // Notify parent when selected configurations change
  useEffect(() => {
    if (onSelectedConfigurationsChange && selectedConfigurations.length > 0) {
      const configInfos: SelectedConfigurationInfo[] =
        selectedConfigurations.map((run) => ({
          id: run.id,
          name: run.name,
          configuration: run.configuration,
        }));
      onSelectedConfigurationsChange(configInfos);
    }
  }, [selectedConfigurations, onSelectedConfigurationsChange]);

  // Sync selected configurations to URL and handle navigation
  useEffect(() => {
    if (selectedConfigurations.length === 0 || !testRunData) return;

    const newSearchParams = new URLSearchParams(searchParams.toString());

    if (selectedConfigurations.length === 1) {
      // Single configuration selected
      newSearchParams.delete("configs");

      if (selectedConfigurations[0].id !== testRunData.id) {
        // Navigate to the different run
        router.push(
          `/projects/runs/${params.projectId}/${selectedConfigurations[0].id}?${newSearchParams.toString()}`
        );
      } else {
        // Same run, just update URL to remove configs param if present
        const currentConfigs = searchParams.get("configs");
        if (currentConfigs) {
          router.replace(`${pathname}?${newSearchParams.toString()}`, { scroll: false });
        }
      }
    } else {
      // Multiple configurations selected - update URL with configs param
      const configIds = selectedConfigurations.map((run) => run.id).join(",");
      const currentConfigs = searchParams.get("configs");

      if (currentConfigs !== configIds) {
        newSearchParams.set("configs", configIds);
        router.replace(`${pathname}?${newSearchParams.toString()}`, { scroll: false });
      }
    }
  }, [
    selectedConfigurations,
    testRunData,
    router,
    params.projectId,
    searchParams,
    pathname,
  ]);

  // Update the parent component when selected test cases change
  useEffect(() => {
    if (onTestCasesChange) {
      onTestCasesChange(selectedTestCases);
    }
  }, [selectedTestCases, onTestCasesChange]);

  // Scroll to selected test case when component mounts and table is ready
  useEffect(() => {
    if (selectedCaseId && isTableReady) {
      // Clear any existing interval
      if (scrollInterval.current) {
        clearInterval(scrollInterval.current);
      }

      // Reset scroll attempts
      scrollAttempts.current = 0;

      // Set up an interval to attempt scrolling
      scrollInterval.current = setInterval(() => {
        const selectedRow = document.querySelector(
          `[data-row-id="${selectedCaseId}"]`
        );

        if (selectedRow) {
          selectedRow.scrollIntoView({ behavior: "smooth", block: "center" });
          // Successfully found and scrolled to the element
          if (scrollInterval.current) {
            clearInterval(scrollInterval.current);
          }
        } else {
          scrollAttempts.current += 1;
          if (scrollAttempts.current >= maxScrollAttempts) {
            // Give up after max attempts
            if (scrollInterval.current) {
              clearInterval(scrollInterval.current);
            }
          }
        }
      }, 100); // Try every 100ms

      // Cleanup function
      return () => {
        if (scrollInterval.current) {
          clearInterval(scrollInterval.current);
        }
      };
    }
  }, [selectedCaseId, isTableReady]);

  // Set table ready state after a short delay to ensure rendering is complete
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsTableReady(true);
    }, 500); // Wait for 500ms after mount

    return () => clearTimeout(timer);
  }, []);

  if (!testRunData) return null;

  const handleStartTesting = () => {
    if (testRunData && testRunData.testCases.length > 0) {
      const sortedTestCases = [...testRunData.testCases].sort(
        (a, b) => a.order - b.order
      );
      const firstTestCaseId = sortedTestCases[0]?.repositoryCase.id;
      if (firstTestCaseId) {
        const newSearchParams = new URLSearchParams(searchParams.toString());
        newSearchParams.set("selectedCase", firstTestCaseId.toString());
        router.push(`${pathname}?${newSearchParams.toString()}`);
      }
    }
  };

  // Map the test cases to the format expected by SelectedTestCasesDrawer
  const mappedTestCases = testRunData.testCases.map((testCase) => ({
    id: testCase.repositoryCase.id,
    name: testCase.repositoryCase.name,
    state: {
      name: testCase.repositoryCase.state.name,
      icon: testCase.repositoryCase.state.icon
        ? { name: testCase.repositoryCase.state.icon.name }
        : undefined,
      color: testCase.repositoryCase.state.color
        ? { value: testCase.repositoryCase.state.color.value }
        : undefined,
    },
    source: testCase.repositoryCase.source,
  }));

  // Helper function to fetch configurations for the combobox
  const fetchConfigurations = async (
    query: string,
    page: number,
    pageSize: number
  ) => {
    // Filter by search query if provided
    let filtered = siblingTestRuns;
    if (query) {
      const lowerQuery = query.toLowerCase();
      filtered = siblingTestRuns.filter(
        (run) =>
          run.name.toLowerCase().includes(lowerQuery) ||
          run.configuration?.name?.toLowerCase().includes(lowerQuery)
      );
    }

    // Apply pagination
    const start = page * pageSize;
    const end = start + pageSize;
    const results = filtered.slice(start, end);

    return {
      results,
      total: filtered.length,
    };
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <span className="text-md font-semibold">
          {isMultiConfigRun && selectedConfigurations.length > 1
            ? t("common.labels.casesInRunMultiConfig", {
                uniqueCount: uniqueTestCasesCount,
                configCount: selectedConfigurations.length,
                totalCount: combinedTestCasesCount,
              })
            : t("common.labels.casesInRun", {
                count: testRunData.testCases.length,
              })}
        </span>
        {!isEditMode &&
          !testRunData.isCompleted &&
          testRunData.testCases.length > 0 &&
          !isLoadingPermissions &&
          canAddEditResults && (
            <Button
              variant="default"
              size="sm"
              onClick={handleStartTesting}
              disabled={isLoadingPermissions}
            >
              <CirclePlay className="h-4 w-4 mr-1" />
              {t("common.actions.startTesting")}
            </Button>
          )}
      </div>

      {/* Configuration selector for multi-config test runs */}
      {isMultiConfigRun && !isEditMode && (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 shrink-0 font-semibold">
            <Combine className="w-4 h-4" />
            <span>{t("common.labels.configurations")}:</span>
          </div>
          <MultiAsyncCombobox<SiblingTestRun>
            value={selectedConfigurations}
            onValueChange={setSelectedConfigurations}
            fetchOptions={fetchConfigurations}
            renderOption={(option) => (
              <div className="flex items-center w-11/12 gap-2 justify-between">
                <ConfigurationNameDisplay
                  configuration={option.configuration}
                  name={option.configuration?.name || option.name}
                  truncate
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {"("}
                  {t("charts.testCases", { count: option.testCases.length })}
                  {")"}
                </span>
              </div>
            )}
            renderSelectedOption={(option) => (
              <span>{option.configuration?.name || option.name}</span>
            )}
            getOptionValue={(option) => option.id}
            getOptionLabel={(option) =>
              option.configuration?.name || option.name
            }
            placeholder={t("common.placeholders.selectConfigurations")}
            className="flex-1"
          />
        </div>
      )}

      <div className="space-y-4">
        {(isEditMode || testRunData.testCases.length > 0) && (
          <ProjectRepository
            isSelectionMode={isEditMode && canAddEdit}
            selectedTestCases={
              isEditMode
                ? selectedTestCases
                : testRunData.testCases.map((tc) => tc.repositoryCase.id)
            }
            selectedRunIds={
              isMultiConfigRun && !isEditMode ? selectedRunIds : undefined
            }
            onSelectionChange={setSelectedTestCases}
            hideHeader={true}
            isRunMode={!isEditMode}
            isCompleted={testRunData.isCompleted}
            projectId={params.projectId}
            ApplicationArea={ApplicationArea.TestRuns}
          />
        )}
        {!isEditMode && testRunData.testCases.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-8">
            <p>{t("common.labels.noTestCasesSelected")}</p>
            <p className="mt-2">{t("common.labels.editToSelectTestCases")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
