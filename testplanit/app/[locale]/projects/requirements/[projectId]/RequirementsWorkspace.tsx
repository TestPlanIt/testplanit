"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SectionHeader } from "@/components/ui/typography";
import { SimpleDndProvider } from "@/components/ui/SimpleDndProvider";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { FileDown } from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { useExportRequirementTraceabilityPdf } from "~/hooks/pdf/useExportRequirementTraceabilityPdf";
import { schema } from "~/zenstack/schema";
import RequirementDetailPanel from "./RequirementDetailPanel";
import RequirementsListView from "./RequirementsListView";

/**
 * The selection contract this workspace owns: which requirement (Issue.id)
 * is currently shown in the detail pane. Exported here so plan 26.2-04's
 * `RequirementsListView` and plan 25-10's `RequirementDetailPanel` import
 * this type rather than restating it — the list and the detail panel never
 * negotiate selection directly, they both go through the workspace.
 */
export interface RequirementSelection {
  selectedRequirementId: number | null;
  onSelectRequirement: (issueId: number | null) => void;
}

interface RequirementsWorkspaceProps {
  projectId: string;
}

/**
 * The master-detail shell for the Requirements surface (IA decision,
 * 25-CONTEXT.md): a new top-level route, not a tab on `/projects/issues`.
 *
 * The left pane mounts plan 26.2-04's `<RequirementsListView />` (a
 * `DataTable`-based tree-table, replacing the earlier react-arborist tree);
 * the right pane (once a requirement is selected) mounts plan 25-10's
 * `<RequirementDetailPanel />`.
 */
export default function RequirementsWorkspace({
  projectId,
}: RequirementsWorkspaceProps) {
  const t = useTranslations();
  const locale = useLocale();
  const { data: sessionAuth } = useSession();
  const [selectedRequirementId, setSelectedRequirementId] = useState<
    number | null
  >(null);

  // Requirements is opt-in per project. Phase 25 gated only the ProjectMenu
  // entry, so a bookmarked URL still reached this page on a project with
  // the feature off; this phase hangs a traceability PDF export off the
  // page, and exporting a feature a project has turned off is worse than a
  // stale bookmark (26-VALIDATION.md resolution O2). The narrow select +
  // `=== true` read mirrors `ProjectMenu.tsx`'s own established flag read.
  // The requirement API routes are deliberately NOT gated on this flag
  // (26-VALIDATION.md carve-out 4) -- it is a presentation opt-in, not an
  // access-control boundary; their real boundary is the viewer's project
  // scope.
  const { data: project } = useClientQueries(schema).projects.useFindUnique(
    {
      where: { id: Number(projectId) },
      select: { requirementsEnabled: true },
    },
    { enabled: Boolean(projectId) && !isNaN(Number(projectId)) }
  );
  const requirementsEnabled = project?.requirementsEnabled === true;

  const { isExporting: isExportingPdf, handleExport: handleExportPdf } =
    useExportRequirementTraceabilityPdf({
      projectId: Number(projectId),
      locale,
      generatedByName: sessionAuth?.user?.name,
      onError: () => toast.error(t("requirements.export.exportFailed")),
    });

  return (
    <main>
      <Card>
        <CardHeader id="requirements-page-header" className="w-full">
          <SectionHeader className="flex items-center justify-between gap-2">
            <CardTitle>{t("common.fields.requirements")}</CardTitle>
            {requirementsEnabled && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportPdf}
                    disabled={isExportingPdf}
                    data-testid="requirements-export-pdf"
                    className={isExportingPdf ? "animate-pulse" : ""}
                  >
                    <FileDown className="h-4 w-4" />
                    {isExportingPdf
                      ? t("common.actions.exportingPdf")
                      : t("common.actions.exportPdf")}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("requirements.export.csvOnReportsHint")}
                </TooltipContent>
              </Tooltip>
            )}
          </SectionHeader>
        </CardHeader>
        <CardContent>
          {requirementsEnabled ? (
            <ResizablePanelGroup
              direction="horizontal"
              autoSaveId="project-requirements-panels"
              className="h-[calc(100vh-14rem)] min-h-[400px]"
              data-testid="requirements-layout"
            >
              <ResizablePanel
                id="requirements-tree"
                order={1}
                defaultSize={30}
                minSize={0}
                maxSize={100}
                className="p-0 m-0"
              >
                <div
                  data-testid="requirements-tree-pane"
                  className="h-full overflow-y-auto"
                >
                  {/* The provider must wrap the list from OUT HERE, not from
                      inside it: RequirementsListView calls react-dnd's useDrop
                      during its own render, so a provider it rendered itself
                      would not yet exist in the tree when that hook runs. This
                      mirrors ProjectRepository.tsx, which wraps TreeView the
                      same way. */}
                  <SimpleDndProvider>
                    <RequirementsListView
                      projectId={projectId}
                      selectedRequirementId={selectedRequirementId}
                      onSelectRequirement={setSelectedRequirementId}
                    />
                  </SimpleDndProvider>
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel
                id="requirements-detail"
                order={2}
                defaultSize={70}
                minSize={0}
                className="p-0 m-0 min-w-[220px]"
              >
                <div
                  data-testid="requirements-detail-pane"
                  className="h-full overflow-y-auto"
                >
                  {selectedRequirementId === null ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      {t("requirements.detail.selectPrompt")}
                    </div>
                  ) : (
                    <RequirementDetailPanel
                      projectId={projectId}
                      requirementId={selectedRequirementId}
                    />
                  )}
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            <div
              data-testid="requirements-disabled-notice"
              className="flex h-[calc(100vh-14rem)] min-h-[400px] flex-col items-center justify-center gap-2 text-center"
            >
              <p className="text-sm font-medium">
                {t("requirements.disabled.title")}
              </p>
              <p className="max-w-md text-sm text-muted-foreground">
                {t("requirements.disabled.description")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
