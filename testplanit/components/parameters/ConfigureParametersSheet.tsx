"use client";

import { DatasetImportWizard } from "@/components/parameters/DatasetImportWizard";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DatasetTab } from "@/components/parameters/DatasetTab";
import { ParametersTab } from "@/components/parameters/ParametersTab";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SquareStack } from "lucide-react";
import { useTranslations } from "next-intl";
import { createContext, useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * Context exposed to descendants of the Sheet so the dataset-cell editor
 * (Plan 02-04) can register that a cell is mid-edit. When `editingCell`
 * is true, the Sheet's onOpenChange suppresses the close so a stray
 * `Esc` cancels the cell first; a second `Esc` then closes the Sheet.
 */
export const SheetEditingContext = createContext<{
  editingCell: boolean;
  setEditingCell: (v: boolean) => void;
}>({
  editingCell: false,
  setEditingCell: () => {},
});

export interface ConfigureParametersSheetProps {
  isOpen: boolean;
  onClose: () => void;
  caseId: number;
  projectId: number;
  /**
   * Optional callback wired by Plan 02-05 to open the multi-step CSV
   * import wizard from the Dataset tab's "Import CSV" toolbar button.
   * If omitted, the button renders but is a no-op until 02-05 lands.
   */
  onOpenImportWizard?: () => void;
}

export function ConfigureParametersSheet({
  isOpen,
  onClose,
  caseId,
  projectId,
  onOpenImportWizard,
}: ConfigureParametersSheetProps) {
  const t = useTranslations("parameters");
  const tCommon = useTranslations("common.actions");
  const [editingCell, setEditingCell] = useState(false);
  const [showImportWizard, setShowImportWizard] = useState(false);

  const { data: parameters = [] } = useClientQueries(schema).testCaseParameter.useFindMany(
    {
      where: { testCaseId: caseId, isDeleted: false },
      orderBy: { order: "asc" },
    },
    { enabled: isOpen }
  );

  // Existing-row count drives the Replace/Append copy in the wizard's
  // Confirm step. Cross-project filter is enforced server-side via the
  // dataset read endpoint (Plan 02-02); the count hook here is purely
  // for display copy.
  const { data: existingRowCount = 0 } = useClientQueries(schema).dataSetRow.useCount(
    {
      where: {
        dataSet: {
          ownerCaseId: caseId,
          projectId,
          isDeleted: false,
        },
        isDeleted: false,
      },
    },
    { enabled: isOpen }
  );

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        toast.message(t("sheetAutoSaveHint"));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, t]);

  const datasetTabDisabled = parameters.length === 0;

  return (
    <SheetEditingContext.Provider value={{ editingCell, setEditingCell }}>
      <Sheet
        open={isOpen}
        onOpenChange={(open) => {
          if (!open && !editingCell) onClose();
        }}
      >
        <SheetContent
          side="right"
          className="sm:max-w-3xl w-full p-0 flex flex-col"
          data-testid="configure-parameters-sheet"
        >
          <SheetHeader className="px-6 pt-6 pb-4 border-b">
            <SheetTitle className="flex items-center gap-2">
              <SquareStack className="h-5 w-5" aria-hidden />
              {t("sheetTitle")}
            </SheetTitle>
            <SheetDescription>{t("sheetDescription")}</SheetDescription>
          </SheetHeader>

          <Tabs
            defaultValue="parameters"
            className="flex-1 flex flex-col overflow-hidden"
          >
            <TabsList className="mx-6 mt-4 flex w-auto">
              <TabsTrigger
                value="parameters"
                data-testid="tab-parameters"
                className="flex-1"
              >
                {t("tabParameters")}
              </TabsTrigger>
              {datasetTabDisabled ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} className="flex-1">
                      <TabsTrigger
                        value="dataset"
                        disabled
                        data-testid="tab-dataset"
                        className="w-full"
                      >
                        {t("tabDataset")}
                      </TabsTrigger>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("tabDatasetDisabledTooltip")}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <TabsTrigger
                  value="dataset"
                  data-testid="tab-dataset"
                  className="flex-1"
                >
                  {t("tabDataset")}
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent
              value="parameters"
              className="flex-1 overflow-auto m-0"
            >
              <ParametersTab
                caseId={caseId}
                projectId={projectId}
                parameters={parameters}
              />
            </TabsContent>

            <TabsContent value="dataset" className="flex-1 overflow-auto m-0">
              {datasetTabDisabled ? null : (
                <DatasetTab
                  caseId={caseId}
                  projectId={projectId}
                  parameters={parameters}
                  onOpenImportWizard={() => {
                    setShowImportWizard(true);
                    onOpenImportWizard?.();
                  }}
                />
              )}
            </TabsContent>
          </Tabs>

          <div className="px-6 py-4 border-t flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              data-testid="configure-parameters-sheet-close"
            >
              {tCommon("close")}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <DatasetImportWizard
        open={showImportWizard}
        onClose={() => setShowImportWizard(false)}
        caseId={caseId}
        parameters={parameters as never}
        existingRowCount={existingRowCount}
      />
    </SheetEditingContext.Provider>
  );
}
