"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Boxes,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  FolderPlus,
  Loader2,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useFindManyProjects,
  useFindFirstRepositories,
  useCreateRepositoryFolders,
  useFindManyRepositoryCases,
} from "~/lib/hooks";
import { useFindManyRepositoryFolders } from "~/lib/hooks/repository-folders";
import { Link } from "~/lib/navigation";
import { cn } from "~/utils";
import type { FolderTreeNode } from "~/workers/copyMoveWorker";

import { useCopyMoveJob } from "./useCopyMoveJob";

type WizardStep = "target" | "configure" | "progress";

export interface CopyMoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCaseIds: number[];
  sourceProjectId: number;
  sourceFolderId?: number; // triggers folder-tree mode
  sourceFolderName?: string; // display name for folder
}

export function CopyMoveDialog({
  open,
  onOpenChange,
  selectedCaseIds,
  sourceProjectId,
  sourceFolderId,
  sourceFolderName,
}: CopyMoveDialogProps) {
  const t = useTranslations("components.copyMove");
  const tCommon = useTranslations("common");
  const tNav = useTranslations("navigation.projects.dropdown");
  const tRepo = useTranslations("repository.cases.importWizard.page1");

  // ── Wizard state ────────────────────────────────────────────────────────
  const [step, setStep] = useState<WizardStep>("target");
  const [targetProjectId, setTargetProjectId] = useState<number | null>(null);
  const [targetFolderId, setTargetFolderId] = useState<number | null>(null);
  const [operation, setOperation] = useState<"copy" | "move">("copy");
  const [conflictResolution, setConflictResolution] = useState<
    "skip" | "rename"
  >("skip");
  const [sharedStepGroupResolution, setSharedStepGroupResolution] = useState<
    "reuse" | "create_new"
  >("reuse");
  const [autoAssignTemplates, setAutoAssignTemplates] = useState(true);
  const [errorsExpanded, setErrorsExpanded] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  // ── Job hook ─────────────────────────────────────────────────────────────
  const job = useCopyMoveJob();

  // ── Data hooks ───────────────────────────────────────────────────────────
  const { data: projects = [], isLoading: projectsLoading } =
    useFindManyProjects({
      where: { isDeleted: false },
      orderBy: [{ isCompleted: "asc" }, { name: "asc" }],
      select: { id: true, name: true, iconUrl: true, isCompleted: true },
    });

  const { data: folders = [], isLoading: foldersLoading } =
    useFindManyRepositoryFolders(
      {
        where: { projectId: targetProjectId ?? 0, isDeleted: false },
        select: { id: true, name: true, parentId: true },
        orderBy: { name: "asc" },
      },
      { enabled: !!targetProjectId }
    );

  // Target project's repository (needed for creating folders)
  const { data: targetRepo } = useFindFirstRepositories(
    {
      where: {
        projectId: targetProjectId ?? 0,
        isActive: true,
        isDeleted: false,
      },
      select: { id: true },
    },
    { enabled: !!targetProjectId }
  );

  const { mutateAsync: createFolder } = useCreateRepositoryFolders();

  // ── Folder-mode data hooks ────────────────────────────────────────────────
  const { data: sourceFolders = [] } = useFindManyRepositoryFolders(
    sourceFolderId
      ? {
          where: { projectId: sourceProjectId, isDeleted: false },
          select: { id: true, name: true, parentId: true, order: true },
        }
      : undefined,
    { enabled: !!sourceFolderId }
  );

  // Collect all folder IDs in the subtree rooted at sourceFolderId
  const folderSubtreeIds = useMemo(() => {
    if (!sourceFolderId || sourceFolders.length === 0) return [];
    const ids: number[] = [];
    const queue: number[] = [sourceFolderId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      ids.push(current);
      const children = sourceFolders.filter((f: any) => f.parentId === current);
      for (const child of children) queue.push(child.id);
    }
    return ids;
  }, [sourceFolderId, sourceFolders]);

  const { data: folderCases = [] } = useFindManyRepositoryCases(
    folderSubtreeIds.length > 0
      ? {
          where: { folderId: { in: folderSubtreeIds }, isDeleted: false },
          select: { id: true, folderId: true },
        }
      : undefined,
    { enabled: folderSubtreeIds.length > 0 }
  );

  // In folder mode use cases from subtree; otherwise fall back to selectedCaseIds
  const effectiveCaseIds = useMemo(() => {
    if (sourceFolderId && folderCases.length > 0) {
      return folderCases.map((c: any) => c.id);
    }
    return selectedCaseIds;
  }, [sourceFolderId, folderCases, selectedCaseIds]);

  // Build BFS-ordered folder tree for submit
  const folderTree: FolderTreeNode[] | undefined = useMemo(() => {
    if (!sourceFolderId || sourceFolders.length === 0) return undefined;

    const casesByFolder = new Map<number, number[]>();
    for (const c of folderCases) {
      const fId = (c as any).folderId as number;
      if (!casesByFolder.has(fId)) casesByFolder.set(fId, []);
      casesByFolder.get(fId)!.push((c as any).id as number);
    }

    const nodes: FolderTreeNode[] = [];
    const queue: Array<{ folderId: number; parentLocalKey: string | null }> = [
      { folderId: sourceFolderId, parentLocalKey: null },
    ];
    while (queue.length > 0) {
      const { folderId, parentLocalKey } = queue.shift()!;
      const folder = sourceFolders.find((f: any) => f.id === folderId);
      if (!folder) continue;
      const localKey = String(folderId);
      nodes.push({
        localKey,
        sourceFolderId: folderId,
        name: (folder as any).name as string,
        parentLocalKey,
        caseIds: casesByFolder.get(folderId) ?? [],
      });
      const children = sourceFolders
        .filter((f: any) => f.parentId === folderId)
        .sort((a: any, b: any) => a.order - b.order);
      for (const child of children) {
        queue.push({ folderId: (child as any).id, parentLocalKey: localKey });
      }
    }
    return nodes.length > 0 ? nodes : undefined;
  }, [sourceFolderId, sourceFolders, folderCases]);

  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName.trim() || !targetProjectId || !targetRepo?.id) return;
    setIsCreatingFolder(true);
    try {
      const maxOrder = folders.reduce(
        (max, f) => Math.max(max, (f as any).order ?? 0),
        0
      );
      const created = await createFolder({
        data: {
          name: newFolderName.trim(),
          project: { connect: { id: targetProjectId } },
          repository: { connect: { id: targetRepo.id } },
          ...(targetFolderId
            ? { parent: { connect: { id: targetFolderId } } }
            : {}),
          order: maxOrder + 1,
        } as any,
      });
      if (created?.id) setTargetFolderId(created.id);
      setNewFolderName("");
    } catch (err) {
      console.error("Failed to create folder:", err);
    } finally {
      setIsCreatingFolder(false);
    }
  }, [
    newFolderName,
    targetProjectId,
    targetRepo,
    targetFolderId,
    folders,
    createFolder,
  ]);

  // ── Reset on open ────────────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setStep("target");
      setTargetProjectId(null);
      setTargetFolderId(null);
      setOperation("copy");
      setConflictResolution("skip");
      setSharedStepGroupResolution("reuse");
      setAutoAssignTemplates(true);
      setErrorsExpanded(false);
      setNewFolderName("");
      setIsCreatingFolder(false);
      job.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Handle dialog close ──────────────────────────────────────────────────
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        const isInProgress =
          job.status === "waiting" || job.status === "active";
        if (!isInProgress) {
          job.reset();
          setStep("target");
          setTargetProjectId(null);
          setTargetFolderId(null);
          setOperation("copy");
          setConflictResolution("skip");
          setSharedStepGroupResolution("reuse");
          setAutoAssignTemplates(true);
          setErrorsExpanded(false);
        }
        // If job in progress: close dialog but let job continue in background
      }
      onOpenChange(nextOpen);
    },
    [job, onOpenChange]
  );

  // ── Preflight helper ─────────────────────────────────────────────────────
  const triggerPreflight = useCallback(
    (op: "copy" | "move", projId: number) => {
      job.runPreflight({
        operation: op,
        caseIds: effectiveCaseIds,
        sourceProjectId,
        targetProjectId: projId,
      });
    },
    [job, effectiveCaseIds, sourceProjectId]
  );

  // ── Step navigation ──────────────────────────────────────────────────────
  const handleNext = () => {
    if (!targetProjectId || !targetFolderId) return;
    triggerPreflight(operation, targetProjectId);
    setStep("configure");
  };

  const handleBack = () => {
    setStep("target");
  };

  const handleGo = () => {
    if (!targetProjectId || !targetFolderId) return;
    job.submit({
      operation,
      caseIds: effectiveCaseIds,
      sourceProjectId,
      targetProjectId,
      targetFolderId,
      conflictResolution,
      sharedStepGroupResolution,
      autoAssignTemplates: job.preflight?.templateMismatch
        ? autoAssignTemplates
        : false,
      targetRepositoryId: job.preflight?.targetRepositoryId,
      targetDefaultWorkflowStateId: job.preflight?.targetDefaultWorkflowStateId,
      targetTemplateId: job.preflight?.targetTemplateId,
      folderTree,
    });
    setStep("progress");
  };

  // ── Derived values ───────────────────────────────────────────────────────
  const filteredProjects = projects.filter((p) => p.id !== sourceProjectId);

  type ProjectOption = (typeof filteredProjects)[number];
  const selectedProject =
    filteredProjects.find((p) => p.id === targetProjectId) ?? null;

  const fetchProjects = useCallback(
    async (query: string) => {
      const filtered = filteredProjects.filter((p) =>
        p.name.toLowerCase().includes(query.toLowerCase())
      );
      return filtered;
    },
    [filteredProjects]
  );
  // Build a flat, depth-annotated folder list preserving parent→child order
  type FolderOption = {
    id: number;
    name: string;
    parentId: number | null;
    depth: number;
  };
  const flatFolders = useMemo(() => {
    const result: FolderOption[] = [];
    const buildTree = (parentId: number | null, depth: number) => {
      for (const f of folders) {
        if (f.parentId === parentId) {
          result.push({ id: f.id, name: f.name, parentId: f.parentId, depth });
          buildTree(f.id, depth + 1);
        }
      }
    };
    buildTree(null, 0);
    return result;
  }, [folders]);

  const selectedFolder: FolderOption | null =
    flatFolders.find((f: FolderOption) => f.id === targetFolderId) ?? null;

  const fetchFolders = useCallback(
    async (query: string) => {
      if (!query) return flatFolders;
      return flatFolders.filter((f: FolderOption) =>
        f.name.toLowerCase().includes(query.toLowerCase())
      );
    },
    [flatFolders]
  );

  const preflight = job.preflight;
  const hasPermissionError =
    (preflight && !preflight.hasTargetWriteAccess) ||
    (operation === "move" && preflight && !preflight.hasSourceUpdateAccess);

  const workflowFallbacks =
    preflight?.workflowMappings.filter((m) => m.isDefaultFallback) ?? [];

  const canGo = !job.isPrefighting && !hasPermissionError && !!targetFolderId;

  const progressValue =
    ((job.progress?.processed ?? 0) / (job.progress?.total ?? 1)) * 100;

  // ── Step metadata ────────────────────────────────────────────────────────
  const stepNumber = step === "target" ? 1 : step === "configure" ? 2 : 3;
  const stepDescriptions: Record<WizardStep, string> = {
    target: t("step1Desc"),
    configure: t("step2Desc"),
    progress: t("step3Desc"),
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{stepDescriptions[step]}</DialogDescription>
          {sourceFolderName && (
            <p className="text-sm text-muted-foreground">
              {t("folderMode", {
                folderName: sourceFolderName,
                caseCount: effectiveCaseIds.length,
              })}
            </p>
          )}
        </DialogHeader>

        {/* Progress indicator — matches ImportCasesWizard pattern */}
        <div className="flex items-center gap-2 mb-4 shrink-0">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  s < stepNumber
                    ? "bg-primary text-primary-foreground"
                    : s === stepNumber
                      ? "bg-primary/10 text-primary border-2 border-primary"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {s < stepNumber ? <CheckCircle2 className="w-4 h-4" /> : s}
              </div>
              {s < 3 && (
                <div
                  className={`w-12 h-0.5 mx-2 ${
                    s < stepNumber ? "bg-primary" : "bg-muted"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-0.5">
          {/* ── Step 1: Target Selection ─────────────────────────────────── */}
          {step === "target" && (
            <div className="flex flex-col gap-4 mb-2">
              <div className="flex flex-col gap-1.5">
                <Label>{t("targetProject")}</Label>
                <AsyncCombobox<ProjectOption>
                  value={selectedProject}
                  onValueChange={(project) => {
                    setTargetProjectId(project?.id ?? null);
                    setTargetFolderId(null);
                  }}
                  fetchOptions={fetchProjects}
                  getOptionValue={(p) => p.id}
                  renderOption={(p) => (
                    <div className="flex items-center gap-2">
                      {p.iconUrl ? (
                        <Image
                          src={p.iconUrl}
                          alt={`${p.name} icon`}
                          width={16}
                          height={16}
                          className="shrink-0 object-contain"
                        />
                      ) : (
                        <Boxes className="h-4 w-4 shrink-0" />
                      )}
                      <span
                        className={cn(
                          "truncate",
                          p.isCompleted && "opacity-60"
                        )}
                      >
                        {p.name}
                      </span>
                      {p.isCompleted && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          {t("completed")}
                        </span>
                      )}
                    </div>
                  )}
                  placeholder={tNav("selectProject")}
                  disabled={projectsLoading}
                  className="w-full"
                />
              </div>

              {targetProjectId && (
                <div>
                  <Label>{t("targetFolder")}</Label>
                  <div className="flex gap-1.5">
                    <AsyncCombobox<FolderOption>
                      value={selectedFolder}
                      onValueChange={(folder) =>
                        setTargetFolderId(folder?.id ?? null)
                      }
                      fetchOptions={fetchFolders}
                      getOptionValue={(f) => f.id}
                      renderOption={(f) => (
                        <div
                          className="flex items-center gap-1.5"
                          style={{ paddingLeft: `${f.depth * 12}px` }}
                        >
                          <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate">{f.name}</span>
                        </div>
                      )}
                      placeholder={tRepo("selectFolderPlaceholder")}
                      disabled={foldersLoading}
                      className="w-full"
                    />
                    <div className="flex items-center gap-2 mb-2">
                      <Input
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        placeholder={t("newFolderPlaceholder")}
                        className="flex-1 min-w-48"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleCreateFolder();
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleCreateFolder}
                        disabled={
                          !newFolderName.trim() ||
                          isCreatingFolder ||
                          !targetRepo?.id
                        }
                        aria-label={tCommon("actions.create")}
                      >
                        <FolderPlus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Configure ────────────────────────────────────────── */}
          {step === "configure" && (
            <div className="flex flex-col gap-4">
              {/* Destination summary */}
              <div className="flex items-center gap-2 text-sm text-muted-foreground rounded-md bg-muted px-3 py-2">
                <FolderOpen className="h-4 w-4 shrink-0" />
                <span>
                  {selectedProject?.name ?? ""} /{" "}
                  <span className="font-medium text-foreground">
                    {selectedFolder?.name ?? ""}
                  </span>
                </span>
              </div>

              {/* Operation selector */}
              <div className="flex flex-col gap-2">
                <Label>{t("operation")}</Label>
                <RadioGroup
                  value={operation}
                  onValueChange={(val) => {
                    const op = val as "copy" | "move";
                    setOperation(op);
                    if (targetProjectId) {
                      triggerPreflight(op, targetProjectId);
                    }
                  }}
                >
                  <div className="flex items-start gap-2">
                    <RadioGroupItem
                      value="copy"
                      id="op-copy"
                      className="mt-0.5"
                    />
                    <div className="flex flex-col gap-0.5">
                      <Label
                        htmlFor="op-copy"
                        className="font-medium cursor-pointer"
                      >
                        {t("operationCopy")}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {t("operationCopyDesc")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <RadioGroupItem
                      value="move"
                      id="op-move"
                      className="mt-0.5"
                    />
                    <div className="flex flex-col gap-0.5">
                      <Label
                        htmlFor="op-move"
                        className="font-medium cursor-pointer"
                      >
                        {t("operationMove")}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {t("operationMoveDesc")}
                      </p>
                    </div>
                  </div>
                </RadioGroup>
              </div>

              {/* Loading preflight */}
              {job.isPrefighting && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("checkingCompatibility")}
                </div>
              )}

              {/* Permission warnings */}
              {preflight && !preflight.hasTargetWriteAccess && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {t("noTargetWriteAccess")}
                  </AlertDescription>
                </Alert>
              )}
              {operation === "move" &&
                preflight &&
                !preflight.hasSourceUpdateAccess && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      {t("noSourceUpdateAccess")}
                    </AlertDescription>
                  </Alert>
                )}

              {/* Template warnings */}
              {preflight?.templateMismatch && (
                <Alert className="border-yellow-400 bg-yellow-50 dark:bg-yellow-950/20">
                  <AlertTitle>{t("templateMismatch")}</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4 mt-1 space-y-0.5">
                      {preflight.missingTemplates.map((tpl) => (
                        <li key={tpl.id} className="text-xs">
                          {tpl.name}
                        </li>
                      ))}
                    </ul>
                    {preflight.canAutoAssignTemplates ? (
                      <div className="flex items-center gap-2 mt-2">
                        <Checkbox
                          id="auto-assign"
                          checked={autoAssignTemplates}
                          onCheckedChange={(checked) =>
                            setAutoAssignTemplates(!!checked)
                          }
                        />
                        <Label
                          htmlFor="auto-assign"
                          className="text-xs cursor-pointer"
                        >
                          {t("autoAssignTemplates")}
                        </Label>
                      </div>
                    ) : (
                      <p className="text-xs mt-2">
                        {t("templatesMayNotDisplay")}
                      </p>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {/* Workflow warnings */}
              {workflowFallbacks.length > 0 && (
                <Alert className="border-yellow-400 bg-yellow-50 dark:bg-yellow-950/20">
                  <AlertTitle>{t("workflowFallback")}</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4 mt-1 space-y-0.5">
                      {workflowFallbacks.map((m) => (
                        <li key={m.sourceStateId} className="text-xs">
                          {m.sourceStateName} {"->"} {m.targetStateName}{" "}
                          {t("default")}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {/* Collision list */}
              {preflight && preflight.collisions.length > 0 && (
                <div className="flex flex-col gap-2">
                  <Label>{t("conflicts")}</Label>
                  <RadioGroup
                    value={conflictResolution}
                    onValueChange={(val) =>
                      setConflictResolution(val as "skip" | "rename")
                    }
                    className="flex gap-4"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="skip" id="cr-skip" />
                      <Label htmlFor="cr-skip" className="cursor-pointer">
                        {t("conflictSkip")}
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="rename" id="cr-rename" />
                      <Label htmlFor="cr-rename" className="cursor-pointer">
                        {t("conflictRename")}
                      </Label>
                    </div>
                  </RadioGroup>
                  <div className="max-h-48 overflow-y-auto border rounded-md divide-y text-sm">
                    {preflight.collisions.map((col) => (
                      <div
                        key={col.caseId}
                        className="px-3 py-1.5 flex flex-col gap-0.5"
                      >
                        <span className="font-medium">{col.caseName}</span>
                        {col.className && (
                          <span className="text-xs text-muted-foreground">
                            {col.className}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Shared step group resolution */}
              <div className="flex flex-col gap-2">
                <Label>{t("sharedStepGroups")}</Label>
                <RadioGroup
                  value={sharedStepGroupResolution}
                  onValueChange={(val) =>
                    setSharedStepGroupResolution(val as "reuse" | "create_new")
                  }
                >
                  <div className="flex items-start gap-2">
                    <RadioGroupItem
                      value="reuse"
                      id="ssg-reuse"
                      className="mt-0.5"
                    />
                    <div className="flex flex-col gap-0.5">
                      <Label htmlFor="ssg-reuse" className="cursor-pointer">
                        {t("sharedStepGroupReuse")}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {t("sharedStepGroupReuseDesc")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <RadioGroupItem
                      value="create_new"
                      id="ssg-new"
                      className="mt-0.5"
                    />
                    <div className="flex flex-col gap-0.5">
                      <Label htmlFor="ssg-new" className="cursor-pointer">
                        {t("sharedStepGroupCreateNew")}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {t("sharedStepGroupCreateNewDesc")}
                      </p>
                    </div>
                  </div>
                </RadioGroup>
              </div>
            </div>
          )}

          {/* ── Step 3: Progress + Results ───────────────────────────────── */}
          {step === "progress" && (
            <div className="flex flex-col gap-4">
              {/* Active / waiting */}
              {(job.status === "waiting" || job.status === "active") && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("processing")}
                  </div>
                  <Progress value={progressValue} />
                  <p className="text-xs text-muted-foreground">
                    {t("progressText", {
                      processed: job.progress?.processed ?? 0,
                      total: job.progress?.total ?? effectiveCaseIds.length,
                    })}
                  </p>
                </div>
              )}

              {/* Completed */}
              {job.status === "completed" && job.result && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    {tCommon("actions.complete")}
                  </div>
                  <p className="text-sm">
                    {t("successCount", {
                      count:
                        (job.result.copiedCount ?? 0) +
                        (job.result.movedCount ?? 0),
                      operation,
                    })}
                  </p>
                  {job.result.skippedCount > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t("skipped", { count: job.result.skippedCount })}
                    </p>
                  )}
                  {job.result.droppedLinkCount > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t("droppedLinks", {
                        count: job.result.droppedLinkCount,
                      })}
                    </p>
                  )}
                  {job.result.errors.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <button
                        className="flex items-center gap-1.5 text-sm text-destructive"
                        onClick={() => setErrorsExpanded((v) => !v)}
                      >
                        <XCircle className="h-4 w-4" />
                        {t("errorCount", { count: job.result.errors.length })}
                      </button>
                      {errorsExpanded && (
                        <ul className="text-xs space-y-1 pl-5 list-disc">
                          {job.result.errors.map((err) => (
                            <li key={err.caseId}>
                              <span className="font-medium">
                                {err.caseName}
                              </span>
                              {": "}
                              {err.error}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {targetProjectId && (
                    <Link
                      href={`/projects/repository/${targetProjectId}${targetFolderId ? `?node=${targetFolderId}&view=folders` : ""}`}
                      className="text-sm text-primary underline"
                    >
                      {t("viewInTargetProject")}
                    </Link>
                  )}
                </div>
              )}

              {/* Failed */}
              {job.status === "failed" && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                    <XCircle className="h-5 w-5" />
                    {t("failed")}
                  </div>
                  {job.error && (
                    <p className="text-sm text-muted-foreground">{job.error}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        {/* end scrollable area */}

        {/* ── Unified footer — matches ImportCasesWizard pattern ──────── */}
        <DialogFooter className="shrink-0">
          {step === "target" && (
            <Button
              onClick={handleNext}
              disabled={!targetProjectId || !targetFolderId}
            >
              {tCommon("actions.next")}
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
          {step === "configure" && (
            <>
              <Button variant="outline" onClick={handleBack}>
                <ChevronLeft className="h-4 w-4" />
                {tCommon("actions.back")}
              </Button>
              <Button onClick={handleGo} disabled={!canGo}>
                {job.isPrefighting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                {t("go")}
              </Button>
            </>
          )}
          {step === "progress" &&
            (job.status === "waiting" || job.status === "active") && (
              <Button variant="outline" onClick={() => job.cancel()}>
                {tCommon("cancel")}
              </Button>
            )}
          {step === "progress" &&
            (job.status === "completed" || job.status === "failed") && (
              <Button onClick={() => handleOpenChange(false)}>
                {tCommon("actions.close")}
              </Button>
            )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
