"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Boxes, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { useFindManyProjects } from "~/lib/hooks";
import { useFindManyRepositoryFolders } from "~/lib/hooks/repository-folders";
import { Link } from "~/lib/navigation";
import { cn } from "~/utils";
import {
  FolderSelect,
  transformFolders,
} from "@/components/forms/FolderSelect";
import { useCopyMoveJob } from "./useCopyMoveJob";

type WizardStep = "target" | "configure" | "progress";

export interface CopyMoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCaseIds: number[];
  sourceProjectId: number;
}

export function CopyMoveDialog({
  open,
  onOpenChange,
  selectedCaseIds,
  sourceProjectId,
}: CopyMoveDialogProps) {
  const t = useTranslations("components.copyMove");

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
      { enabled: !!targetProjectId },
    );

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
    [job, onOpenChange],
  );

  // ── Preflight helper ─────────────────────────────────────────────────────
  const triggerPreflight = useCallback(
    (op: "copy" | "move", projId: number) => {
      job.runPreflight({
        operation: op,
        caseIds: selectedCaseIds,
        sourceProjectId,
        targetProjectId: projId,
      });
    },
    [job, selectedCaseIds, sourceProjectId],
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
      caseIds: selectedCaseIds,
      sourceProjectId,
      targetProjectId,
      targetFolderId,
      conflictResolution,
      sharedStepGroupResolution,
      autoAssignTemplates: job.preflight?.templateMismatch
        ? autoAssignTemplates
        : false,
      targetRepositoryId: job.preflight?.targetRepositoryId,
      targetDefaultWorkflowStateId:
        job.preflight?.targetDefaultWorkflowStateId,
      targetTemplateId: job.preflight?.targetTemplateId,
    });
    setStep("progress");
  };

  // ── Derived values ───────────────────────────────────────────────────────
  const filteredProjects = projects.filter((p) => p.id !== sourceProjectId);
  const folderOptions = transformFolders(folders);

  const preflight = job.preflight;
  const hasPermissionError =
    (preflight && !preflight.hasTargetWriteAccess) ||
    (operation === "move" && preflight && !preflight.hasSourceDeleteAccess);

  const workflowFallbacks =
    preflight?.workflowMappings.filter((m) => m.isDefaultFallback) ?? [];

  const canGo =
    !job.isPrefighting && !hasPermissionError && !!targetFolderId;

  const progressValue =
    ((job.progress?.processed ?? 0) / (job.progress?.total ?? 1)) * 100;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>

        {/* ── Step 1: Target Selection ─────────────────────────────────── */}
        {step === "target" && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>{t("targetProject")}</Label>
              <div className="border rounded-md overflow-hidden">
                <Command>
                  <CommandInput placeholder={t("searchProjects")} />
                  <CommandList className="max-h-[200px]">
                    {projectsLoading ? (
                      <CommandEmpty>{t("loadingProjects")}</CommandEmpty>
                    ) : filteredProjects.length === 0 ? (
                      <CommandEmpty>{t("noProjectsFound")}</CommandEmpty>
                    ) : (
                      <CommandGroup>
                        {filteredProjects.map((project) => (
                          <CommandItem
                            key={project.id}
                            value={project.name}
                            onSelect={() => {
                              setTargetProjectId(project.id);
                              setTargetFolderId(null);
                            }}
                            className={cn(
                              targetProjectId === project.id &&
                                "bg-accent text-accent-foreground",
                            )}
                          >
                            {project.iconUrl ? (
                              <Image
                                src={project.iconUrl}
                                alt={`${project.name} icon`}
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
                                project.isCompleted && "opacity-60",
                              )}
                            >
                              {project.name}
                            </span>
                            {project.isCompleted && (
                              <span className="ml-auto text-xs text-muted-foreground">
                                {t("completed")}
                              </span>
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </div>
            </div>

            {targetProjectId && (
              <div className="flex flex-col gap-1.5">
                <Label>{t("targetFolder")}</Label>
                <FolderSelect
                  value={targetFolderId}
                  onChange={(val) =>
                    setTargetFolderId(val ? Number(val) : null)
                  }
                  folders={folderOptions}
                  isLoading={foldersLoading}
                  placeholder={t("selectFolder")}
                />
              </div>
            )}

            <DialogFooter>
              <Button
                onClick={handleNext}
                disabled={!targetProjectId || !targetFolderId}
              >
                {t("next")}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ── Step 2: Configure ────────────────────────────────────────── */}
        {step === "configure" && (
          <div className="flex flex-col gap-4">
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
                  <RadioGroupItem value="copy" id="op-copy" className="mt-0.5" />
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor="op-copy" className="font-medium cursor-pointer">
                      {t("operationCopy")}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t("operationCopyDesc")}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="move" id="op-move" className="mt-0.5" />
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor="op-move" className="font-medium cursor-pointer">
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
              !preflight.hasSourceDeleteAccess && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {t("noSourceDeleteAccess")}
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
                      <Label htmlFor="auto-assign" className="text-xs cursor-pointer">
                        {t("autoAssignTemplates")}
                      </Label>
                    </div>
                  ) : (
                    <p className="text-xs mt-2">{t("templatesMayNotDisplay")}</p>
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

            <DialogFooter>
              <Button variant="outline" onClick={handleBack}>
                {t("back")}
              </Button>
              <Button onClick={handleGo} disabled={!canGo}>
                {job.isPrefighting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                {t("go")}
              </Button>
            </DialogFooter>
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
                    total: job.progress?.total ?? selectedCaseIds.length,
                  })}
                </p>
                <DialogFooter>
                  <Button variant="outline" onClick={() => job.cancel()}>
                    {t("cancel")}
                  </Button>
                </DialogFooter>
              </div>
            )}

            {/* Completed */}
            {job.status === "completed" && job.result && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  {t("complete")}
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
                    {t("droppedLinks", { count: job.result.droppedLinkCount })}
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
                            <span className="font-medium">{err.caseName}</span>
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
                    href={`/projects/repository/${targetProjectId}`}
                    className="text-sm text-primary underline"
                  >
                    {t("viewInTargetProject")}
                  </Link>
                )}
                <DialogFooter>
                  <Button onClick={() => handleOpenChange(false)}>
                    {t("close")}
                  </Button>
                </DialogFooter>
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
                <DialogFooter>
                  <Button onClick={() => handleOpenChange(false)}>
                    {t("close")}
                  </Button>
                </DialogFooter>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
