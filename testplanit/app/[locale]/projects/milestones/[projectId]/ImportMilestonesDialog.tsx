"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { AlertCircle, Loader2, PackageOpen, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

interface ExternalMilestone {
  id: string;
  kind: "RELEASE" | "ITERATION";
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  state: "FUTURE" | "ACTIVE" | "CLOSED";
  rawState?: string;
  url?: string;
  /** Mapping(s) whose fetch returned this artifact (multi-mapping projects). */
  sourceProjects?: { id: string; key: string; name: string }[];
}

interface ImportMilestonesDialogProps {
  integrationId: number;
  projectId: number;
  /** IntegrationProject.id — the project<->tracker mapping. */
  projectMappingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the queued externalIds after an import is successfully
   *  queued, so the caller can poll/track their arrival. */
  onStarted?: (externalIds: string[]) => void;
}

export function ImportMilestonesDialog({
  integrationId,
  projectId,
  projectMappingId,
  open,
  onOpenChange,
  onStarted,
}: ImportMilestonesDialogProps) {
  const t = useTranslations("milestones.import");
  const tCommon = useTranslations("common");
  const tIssues = useTranslations("issues");

  const [items, setItems] = useState<ExternalMilestone[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isImporting, setIsImporting] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Already-linked external ids for this integration in this project, so
  // the picker can disable+badge rows the same way search-issues-dialog
  // does for already-linked issues. Detached milestones (converted to
  // local by upstream removal or manual unlink) keep their externalId /
  // integrationId for re-link detection, but they are NOT linked — the
  // artifact must show as importable again, and importing re-attaches the
  // existing row (D-12) instead of creating a duplicate.
  const { data: linkedMilestones } = useClientQueries(
    schema
  ).milestones.useFindMany(
    {
      where: {
        projectId,
        integrationId,
        isDeleted: false,
        externalId: { not: null },
        detachedAt: null,
      },
      select: { externalId: true },
    },
    { enabled: open }
  );

  const linkedExternalIds = new Set(
    (linkedMilestones ?? [])
      .map((m) => m.externalId)
      .filter((id): id is string => Boolean(id))
  );

  const fetchPreview = useCallback(
    async (closed: boolean) => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          projectMappingId,
          includeClosed: String(closed),
        });
        const res = await fetch(
          `/api/integrations/${integrationId}/milestone-sync/preview?${params.toString()}`
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || t("previewFailed"));
        }
        setItems(data.items ?? []);
        setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      } catch (e: any) {
        setError(e?.message || t("previewFailed"));
        setItems([]);
      } finally {
        setIsLoading(false);
      }
    },
    [integrationId, projectMappingId, t]
  );

  // Reset + fetch each time the dialog opens.
  useEffect(() => {
    if (open) {
      setIncludeClosed(false);
      setSelectedIds(new Set());
      setError(null);
      setSearchText("");
      setProjectFilter(null);
      setWarnings([]);
      void fetchPreview(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectMappingId]);

  const handleShowClosedToggle = (checked: boolean) => {
    setIncludeClosed(checked);
    void fetchPreview(checked);
  };

  // Distinct source Jira projects present in the result set — drives the
  // filter chips (mirrors search-issues-dialog's 2+ mappings rule).
  const sourceProjectOptions: { id: string; key: string; name: string }[] = [];
  {
    const seen = new Set<string>();
    for (const item of items) {
      for (const sp of item.sourceProjects ?? []) {
        if (!seen.has(sp.id)) {
          seen.add(sp.id);
          sourceProjectOptions.push(sp);
        }
      }
    }
  }
  const showProjectMeta = sourceProjectOptions.length >= 2;

  const normalizedSearch = searchText.trim().toLowerCase();
  const visibleItems = items.filter((item) => {
    if (
      projectFilter &&
      !(item.sourceProjects ?? []).some((sp) => sp.id === projectFilter)
    ) {
      return false;
    }
    if (
      normalizedSearch &&
      !item.name.toLowerCase().includes(normalizedSearch)
    ) {
      return false;
    }
    return true;
  });

  // All/None toggle operates on the currently-visible, not-yet-linked rows.
  const selectableIds = visibleItems
    .filter((item) => !linkedExternalIds.has(item.id))
    .map((item) => item.id);
  const allSelectableSelected =
    selectableIds.length > 0 &&
    selectableIds.every((id) => selectedIds.has(id));

  const toggleSelectAll = () => {
    setSelectedIds(allSelectableSelected ? new Set() : new Set(selectableIds));
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleConfirmSelection = async () => {
    if (selectedIds.size === 0) return;
    setIsImporting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/integrations/${integrationId}/milestone-sync/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectMappingId,
            externalIds: Array.from(selectedIds),
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || t("importFailed"));
      }
      toast.success(t("importStarted"));
      const queuedIds = Array.from(selectedIds);
      setSelectedIds(new Set());
      onStarted?.(queuedIds);
      onOpenChange(false);
    } catch (e: any) {
      setError(e?.message || t("importFailed"));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t("importTitle")}</DialogTitle>
          <DialogDescription>{t("importDescription")}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            data-testid="import-milestones-search"
            placeholder={t("searchPlaceholder")}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="ps-10"
          />
        </div>

        {showProjectMeta && (
          <div className="flex flex-wrap gap-1">
            <Badge
              variant={projectFilter === null ? "default" : "outline"}
              className="cursor-pointer"
              data-testid="import-milestones-project-all"
              onClick={() => setProjectFilter(null)}
            >
              {tIssues("filterAll")}
            </Badge>
            {sourceProjectOptions.map((sp) => (
              <Badge
                key={sp.id}
                variant={projectFilter === sp.id ? "default" : "outline"}
                className="cursor-pointer max-w-40 truncate"
                data-testid="import-milestones-project-chip"
                title={sp.name}
                onClick={() => setProjectFilter(sp.id)}
              >
                {sp.name}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Switch
              id="milestone-import-show-closed"
              checked={includeClosed}
              onCheckedChange={handleShowClosedToggle}
              disabled={isLoading}
            />
            <Label htmlFor="milestone-import-show-closed">
              {t("showClosed")}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="milestone-import-select-all"
              data-testid="import-milestones-select-all"
              checked={
                selectableIds.length > 0 && allSelectableSelected
                  ? true
                  : selectedIds.size > 0
                    ? "indeterminate"
                    : false
              }
              disabled={isLoading || selectableIds.length === 0}
              onCheckedChange={toggleSelectAll}
            />
            <Label htmlFor="milestone-import-select-all">
              {t("selectAll")}
            </Label>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {warnings.length > 0 && (
          <Alert data-testid="import-milestones-warnings">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {t("partialWarning")} {warnings.join("; ")}
            </AlertDescription>
          </Alert>
        )}

        <ScrollArea className="h-[360px] rounded-md border w-full">
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <PackageOpen className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-sm text-muted-foreground">
                {items.length === 0 ? t("empty") : t("emptyFiltered")}
              </p>
            </div>
          ) : (
            <div className="p-4 space-y-2 w-full">
              {visibleItems.map((item) => {
                const isAlreadyLinked = linkedExternalIds.has(item.id);
                const isSelected = selectedIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    data-testid="import-milestone-row"
                    className={`rounded-lg border p-3 transition-colors ${
                      isAlreadyLinked
                        ? "border-muted bg-muted/50 opacity-40 cursor-not-allowed"
                        : isSelected
                          ? "border-primary bg-primary/5 cursor-pointer"
                          : "hover:bg-accent hover:text-accent-foreground cursor-pointer"
                    }`}
                    onClick={() => !isAlreadyLinked && toggleSelected(item.id)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Checkbox
                        checked={isSelected}
                        disabled={isAlreadyLinked}
                        onCheckedChange={() =>
                          !isAlreadyLinked && toggleSelected(item.id)
                        }
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium truncate">
                            {item.name}
                          </span>
                          <span className="ms-auto flex items-center gap-2 shrink-0">
                            {isAlreadyLinked && (
                              <Badge variant="secondary" className="text-xs">
                                {t("alreadyLinked")}
                              </Badge>
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>
                            {item.kind === "RELEASE"
                              ? t("kindRelease")
                              : t("kindSprint")}
                          </span>
                          {item.rawState && <span>{item.rawState}</span>}
                          {showProjectMeta &&
                            (item.sourceProjects ?? []).length > 0 && (
                              <span
                                className="truncate"
                                data-testid="import-milestone-source"
                                title={(item.sourceProjects ?? [])
                                  .map((sp) => sp.name)
                                  .join(", ")}
                              >
                                {(item.sourceProjects ?? [])
                                  .map((sp) => sp.key)
                                  .join(" · ")}
                              </span>
                            )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {selectedIds.size > 0 && (
          <div className="flex items-center justify-between rounded-lg border bg-muted/50 p-4">
            <span className="text-sm font-medium">
              {t("selectedCount", { count: selectedIds.size })}
            </span>
            <Button
              onClick={handleConfirmSelection}
              size="sm"
              disabled={isImporting}
            >
              {isImporting && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("confirmSelection")}
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isImporting}
          >
            {tCommon("cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
