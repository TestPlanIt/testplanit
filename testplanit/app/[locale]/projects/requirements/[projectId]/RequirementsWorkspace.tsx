"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HelpPopover } from "@/components/ui/help-popover";
import { ProjectIcon } from "@/components/ProjectIcon";
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
import LoadingSpinner from "@/components/LoadingSpinner";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardPlus,
  FileDown,
} from "lucide-react";
import { PanelImperativeHandle } from "react-resizable-panels";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useExportRequirementTraceabilityPdf } from "~/hooks/pdf/useExportRequirementTraceabilityPdf";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { schema } from "~/zenstack/schema";
import RequirementDetailPanel from "./RequirementDetailPanel";
// Imported under an alias: the structural drag-drop-nesting guard in
// `RequirementsWorkspace.test.tsx` does a raw text search for the literal
// JSX tag `<RequirementsListView` in this file, and `useRef<Requirements
// ListViewHandle>` would otherwise collide with that search as a false
// match (the generic's `<` immediately precedes the same prefix).
import RequirementsListView, {
  type RequirementsListViewHandle as ListViewHandle,
} from "./RequirementsListView";

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
  // The row menu's Edit action: select the row AND ask the panel to open in
  // edit mode. A monotonically increasing token (never a bare id) so the
  // panel can tell a NEW request for the already-selected row from the one
  // it has already consumed -- edit, cancel, edit again must work.
  const [editRequest, setEditRequest] = useState<{
    id: number;
    token: number;
  } | null>(null);
  const handleRequestEdit = useCallback((issueId: number) => {
    setSelectedRequirementId(issueId);
    setEditRequest((prev) => ({ id: issueId, token: (prev?.token ?? 0) + 1 }));
  }, []);
  // The Add Requirement button below (gap closure 26.2-16, UAT gap 13)
  // reaches the list's own Create Requirement dialog state through this
  // ref -- see `RequirementsListViewHandle`'s doc comment.
  const listViewRef = useRef<ListViewHandle>(null);

  // Collapse/expand for the tree pane, ported from ProjectRepository.tsx's
  // folder-tree toggle (operator request 2026-08-25): same collapsible-panel
  // wiring, same chevron button riding the resize handle.
  const treePanelRef = useRef<PanelImperativeHandle>(null);
  const [isTreeCollapsed, setIsTreeCollapsed] = useState(false);

  const toggleTreeCollapse = () => {
    const panel = treePanelRef.current;
    if (!panel) return;
    if (isTreeCollapsed) {
      panel.expand();
    } else {
      panel.collapse();
    }
    setIsTreeCollapsed(!isTreeCollapsed);
  };
  // Same field `RequirementsListView.tsx` reads for its own reparent/
  // delete/detach gate -- mirrored here so the action bar's Add
  // Requirement button is gated identically to the toolbar button it
  // replaces.
  const { isProjectAdmin: canAddEdit } = useProjectPermissions(
    Number(projectId)
  );

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
  const { data: project, isPending: isProjectFlagPending } = useClientQueries(
    schema
  ).projects.useFindUnique(
    {
      where: { id: Number(projectId) },
      // name/iconUrl feed the header's CardDescription -- the same query
      // that already gates the page, widened rather than duplicated.
      select: { requirementsEnabled: true, name: true, iconUrl: true },
    },
    { enabled: Boolean(projectId) && !isNaN(Number(projectId)) }
  );
  const requirementsEnabled = project?.requirementsEnabled === true;
  // Three states, not two: while the query is in flight neither the enabled
  // panel group nor the disabled notice is known to be correct yet, so both
  // stay hidden behind a loading placeholder (fails CLOSED -- the export
  // action below is gated on `!isGateResolving` too, for the same reason).
  const isGateResolving = isProjectFlagPending === true;

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
        <CardHeader
          id="requirements-page-header"
          data-testid="requirements-page-header"
          className="w-full"
        >
          <div className="flex items-center justify-between gap-2">
            <SectionHeader className="flex items-center gap-2">
              <CardTitle>{t("common.fields.requirements")}</CardTitle>
              <HelpPopover helpKey="projectRequirements" />
            </SectionHeader>
            {requirementsEnabled && !isGateResolving && (
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      onClick={handleExportPdf}
                      disabled={isExportingPdf}
                      data-testid="requirements-export-pdf"
                      aria-label={t("common.actions.exportPdf")}
                      className={`group gap-0 transition-all duration-200 hover:gap-2${
                        isExportingPdf ? " animate-pulse" : ""
                      }`}
                    >
                      <FileDown className="h-4 w-4" />
                      <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-xs">
                        {isExportingPdf
                          ? t("common.actions.exportingPdf")
                          : t("common.actions.exportPdf")}
                      </span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("requirements.export.csvOnReportsHint")}
                  </TooltipContent>
                </Tooltip>
                {canAddEdit && (
                  <Button
                    data-testid="requirements-tree-add-root"
                    onClick={() => listViewRef.current?.openCreateRoot()}
                    aria-label={t("requirements.tree.addRoot")}
                    className="group gap-0 transition-all duration-200 hover:gap-2"
                  >
                    <ClipboardPlus className="h-4 w-4" />
                    <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-xs">
                      {t("requirements.tree.addRoot")}
                    </span>
                  </Button>
                )}
              </div>
            )}
          </div>
          <CardDescription>
            <span className="flex items-center gap-2">
              <ProjectIcon iconUrl={project?.iconUrl} />
              {project?.name}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isGateResolving ? (
            <div
              data-testid="requirements-gate-loading"
              className="flex h-[calc(100vh-14rem)] min-h-[400px] items-center justify-center"
            >
              <LoadingSpinner />
            </div>
          ) : requirementsEnabled ? (
            // The height cap lives on this WRAPPER, not the group:
            // react-resizable-panels sets an inline height on the group
            // element that silently overrides a Tailwind h-[...] class, so
            // the "capped" group actually grew with the detail panel's
            // content and pushed the list (and the drop-to-root strip)
            // below the fold (operator UAT, measured at 1396px vs the
            // 852px cap). With the cap on a plain parent div, the group's
            // inline 100% resolves against it and the detail pane scrolls
            // internally instead of stretching the page.
            <div className="h-[calc(100vh-14rem)] min-h-[400px]">
              <ResizablePanelGroup
                direction="horizontal"
                autoSaveId="project-requirements-panels"
                className="h-full"
                data-testid="requirements-layout"
              >
                <ResizablePanel
                  id="requirements-tree"
                  order={1}
                  ref={treePanelRef}
                  defaultSize={30}
                  collapsedSize={0}
                  minSize={10}
                  maxSize={100}
                  collapsible
                  onCollapse={() => setIsTreeCollapsed(true)}
                  onExpand={() => setIsTreeCollapsed(false)}
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
                        ref={listViewRef}
                        projectId={projectId}
                        selectedRequirementId={selectedRequirementId}
                        onSelectRequirement={setSelectedRequirementId}
                        onRequestEdit={handleRequestEdit}
                      />
                    </SimpleDndProvider>
                  </div>
                </ResizablePanel>
                <ResizableHandle withHandle className="w-1" />
                <div className="shrink-0 pt-0.5">
                  <Button
                    type="button"
                    onClick={toggleTreeCollapse}
                    variant="secondary"
                    className="p-0 -ms-1 rounded-s-none"
                    data-testid="requirements-tree-collapse-toggle"
                  >
                    {isTreeCollapsed ? <ChevronRight /> : <ChevronLeft />}
                  </Button>
                </div>
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
                        // Reaches the SAME delete dialog + descendant count
                        // the row action opens, through the list's own ref
                        // -- never a
                        // second delete path. Gated on `canAddEdit` here,
                        // not inside the panel: the row action menu that
                        // carries Delete is itself rendered only under this
                        // same flag (RequirementsListColumns.tsx), and this
                        // workspace is the only place that already knows
                        // it -- a second `useProjectPermissions` call
                        // inside the panel would be a second owner of the
                        // same answer.
                        onRequestDelete={
                          canAddEdit
                            ? () =>
                                listViewRef.current?.openDeleteDialog(
                                  selectedRequirementId
                                )
                            : undefined
                        }
                        editRequest={editRequest}
                      />
                    )}
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
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
