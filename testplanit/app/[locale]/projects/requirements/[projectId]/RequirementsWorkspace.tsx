"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { SectionHeader } from "@/components/ui/typography";
import { SimpleDndProvider } from "@/components/ui/SimpleDndProvider";
import { useTranslations } from "next-intl";
import { useState } from "react";
import RequirementDetailPanel from "./RequirementDetailPanel";
import RequirementsTreeView from "./RequirementsTreeView";

/**
 * The selection contract this workspace owns: which requirement (Issue.id)
 * is currently shown in the detail pane. Exported here so plan 25-08's
 * `RequirementsTreeView` and plan 25-10's `RequirementDetailPanel` import
 * this type rather than restating it — the tree and the detail panel never
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
 * The left pane mounts plan 25-08's `<RequirementsTreeView />`; the right
 * pane (once a requirement is selected) mounts plan 25-10's
 * `<RequirementDetailPanel />`. No `DataTable`, no filter/sort bar — a tree
 * has different interaction needs than the flat sortable issues list.
 */
export default function RequirementsWorkspace({
  projectId,
}: RequirementsWorkspaceProps) {
  const t = useTranslations();
  const [selectedRequirementId, setSelectedRequirementId] = useState<
    number | null
  >(null);

  return (
    <main>
      <Card>
        <CardHeader id="requirements-page-header" className="w-full">
          <SectionHeader className="flex items-center gap-2">
            <CardTitle>{t("common.fields.requirements")}</CardTitle>
          </SectionHeader>
        </CardHeader>
        <CardContent>
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
              minSize={20}
              maxSize={60}
              className="p-0 m-0"
            >
              <div
                data-testid="requirements-tree-pane"
                className="h-full overflow-y-auto"
              >
                {/* The provider must wrap the tree from OUT HERE, not from
                    inside it: RequirementsTreeView calls react-dnd's useDrop
                    during its own render, so a provider it rendered itself
                    would not yet exist in the tree when that hook runs. This
                    mirrors ProjectRepository.tsx, which wraps TreeView the
                    same way. */}
                <SimpleDndProvider>
                  <RequirementsTreeView
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
              minSize={30}
              className="p-0 m-0 min-w-[320px]"
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
        </CardContent>
      </Card>
    </main>
  );
}
