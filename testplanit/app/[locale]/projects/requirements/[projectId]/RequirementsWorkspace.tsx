"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useTranslations } from "next-intl";
import { useState } from "react";

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
 * This plan lands the shell only — the left pane is a placeholder for plan
 * 25-08's `<RequirementsTreeView />` and the right pane (once a requirement
 * is selected) is a placeholder for plan 25-10's `<RequirementDetailPanel />`.
 * No `DataTable`, no filter/sort bar — a tree has different interaction
 * needs than the flat sortable issues list.
 */
export default function RequirementsWorkspace({
  projectId: _projectId,
}: RequirementsWorkspaceProps) {
  const t = useTranslations();
  const [selectedRequirementId, setSelectedRequirementId] = useState<
    number | null
  >(null);

  return (
    <main>
      <Card>
        <CardHeader>
          <CardTitle>{t("common.fields.requirements")}</CardTitle>
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
              {/*
                Plan 25-08 replaces this with <RequirementsTreeView />, wired
                to `selectedRequirementId`/`setSelectedRequirementId` above
                via the `RequirementSelection` contract.
              */}
              <div
                data-testid="requirements-tree-pane"
                className="h-full overflow-y-auto"
              />
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
                  // Plan 25-10 replaces this with <RequirementDetailPanel />.
                  <div
                    data-testid="requirements-detail-panel-placeholder"
                    className="h-full"
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
