"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  checkAiExportAvailable,
  generateAiExport,
  generateAiExportBatch,
  type AiExportResult,
} from "~/app/actions/aiExportActions";
import {
  fetchCasesForQuickScript,
  type QuickScriptCaseData,
} from "~/app/actions/quickScriptActions";
import {
  useFindManyCaseExportTemplate,
  useFindManyCaseExportTemplateProjectAssignment,
  useFindUniqueProjects,
} from "~/lib/hooks";
import { logDataExport } from "~/lib/services/auditClient";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Check, ChevronsUpDown, Loader2, Sparkles, Star } from "lucide-react";
import { cn } from "~/utils";
import { ExportPreviewPane } from "./ExportPreviewPane";
import { sanitizeFilename } from "./quickScriptUtils";

/** Strip leading/trailing markdown code fences that some LLMs emit. */
function stripFences(code: string): string {
  return code
    .replace(/^```[\w]*\r?\n?/, "")
    .replace(/\r?\n?```\s*$/, "")
    .trim();
}

/**
 * Consume the SSE stream from /api/export/ai-stream.
 * Calls `onChunk` for each text delta so the caller can update UI live.
 * Resolves with the completed result once the stream closes.
 */
async function streamExportCase(
  body: object,
  signal: AbortSignal,
  onChunk: (delta: string) => void
): Promise<{
  code: string;
  generatedBy: "ai" | "template";
  error?: string;
  truncated?: boolean;
  contextFiles?: string[];
}> {
  const response = await fetch("/api/export/ai-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Stream request failed: HTTP ${response.status}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data: ")) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === "chunk") {
          accumulated += data.delta;
          onChunk(data.delta);
        } else if (data.type === "done") {
          return {
            code: stripFences(accumulated),
            generatedBy: "ai",
            contextFiles: data.contextFiles,
            truncated: data.finishReason === "length",
          };
        } else if (data.type === "fallback") {
          return {
            code: data.code,
            generatedBy: "template",
            error: data.error,
          };
        } else if (data.type === "error") {
          throw new Error(data.message);
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue; // skip malformed events
        throw e;
      }
    }
  }

  // Stream ended without a done/fallback event (e.g. connection dropped)
  return { code: stripFences(accumulated), generatedBy: "ai" };
}

type FileGenStatus = "pending" | "generating" | "done" | "error";

export interface ParallelFileProgress {
  caseId: number;
  caseName: string;
  status: FileGenStatus;
  error?: string;
}

interface QuickScriptModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCaseIds: number[];
  projectId: number;
}

export function QuickScriptModal({
  isOpen,
  onClose,
  selectedCaseIds,
  projectId,
}: QuickScriptModalProps) {
  const t = useTranslations("repository.quickScript");
  const tAi = useTranslations("repository.aiExport");
  const tExportModal = useTranslations("repository.exportModal");
  const tCases = useTranslations("repository.cases");
  const tCommon = useTranslations("common");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [outputMode, setOutputMode] = useState<"single" | "individual">(
    selectedCaseIds.length === 1 ? "single" : "individual"
  );
  const [isExporting, setIsExporting] = useState(false);

  // AI export state
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [hasCodeContext, setHasCodeContext] = useState(false);
  const [aiCheckLoading, setAiCheckLoading] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [previewResults, setPreviewResults] = useState<AiExportResult[]>([]);
  const [generationProgress, setGenerationProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  // Live code text while the LLM response is streaming in
  const [streamingCode, setStreamingCode] = useState<string | null>(null);
  // Per-file progress tracking for parallel individual mode
  const [parallelProgress, setParallelProgress] = useState<
    ParallelFileProgress[] | null
  >(null);
  // Per-file AbortControllers for individual cancellation
  const fileAbortControllersRef = useRef<Map<number, AbortController>>(
    new Map()
  );
  // Accumulates streaming chunks per file without triggering renders
  const fileStreamingRef = useRef<Record<number, string>>({});
  // Periodically flushed snapshot of streaming content for the UI
  const [fileStreamingSnippets, setFileStreamingSnippets] = useState<
    Record<number, string>
  >({});
  // Interval handle for periodic flush
  const streamingFlushRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Store case data for retry support
  const casesDataRef = useRef<QuickScriptCaseData[]>([]);
  // Cancel signal for mid-generation cancellation
  const cancelledRef = useRef(false);
  // AbortController for the active streaming fetch
  const abortControllerRef = useRef<AbortController | null>(null);
  // True when the current preview was generated as a single batch AI call
  const isBatchModeRef = useRef(false);
  // Monotonically-increasing run ID — prevents a stale finally block from a
  // cancelled run resetting isExporting after a new export has already started.
  const exportRunIdRef = useRef(0);

  const { data: templates } = useFindManyCaseExportTemplate({
    where: {
      isDeleted: false,
      isEnabled: true,
    },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });

  // Fetch project template assignments (EXPORT-01, EXPORT-03)
  const { data: assignments } = useFindManyCaseExportTemplateProjectAssignment({
    where: { projectId },
  });

  // Fetch project for defaultCaseExportTemplateId (EXPORT-02)
  const { data: project } = useFindUniqueProjects({
    where: { id: projectId },
    select: { defaultCaseExportTemplateId: true },
  });

  // Determine whether the project has any template assignments at all
  const hasAssignments =
    assignments !== undefined && assignments !== null && assignments.length > 0;

  // Build the filtered template list:
  // - No assignments exist → show all enabled templates (backward compatible, EXPORT-03)
  // - Assignments exist → show only assigned templates that are enabled and not deleted (EXPORT-01)
  const filteredTemplates = useMemo(() => {
    if (!hasAssignments) {
      return templates ?? [];
    }
    const assignedTemplateIds = new Set(assignments!.map((a) => a.templateId));
    return (templates ?? []).filter((t) => assignedTemplateIds.has(t.id));
  }, [hasAssignments, assignments, templates]);

  // Detect the "assignments exist but all are unavailable" empty state
  const assignmentsExistButEmpty =
    hasAssignments && filteredTemplates.length === 0;

  // Template pre-selection priority (EXPORT-02):
  // 1. User's explicit selection (selectedTemplateId)
  // 2. Project default (defaultCaseExportTemplateId) — if it's in the filtered list
  // 3. Global isDefault — if it's in the filtered list
  // 4. First available template
  const defaultTemplate = useMemo(() => {
    if (!filteredTemplates || filteredTemplates.length === 0) return undefined;

    // Project default takes precedence
    if (project?.defaultCaseExportTemplateId) {
      const projectDefault = filteredTemplates.find(
        (t) => t.id === project.defaultCaseExportTemplateId
      );
      if (projectDefault) return projectDefault;
    }

    // Fall back to global isDefault
    const globalDefault = filteredTemplates.find((t) => t.isDefault);
    if (globalDefault) return globalDefault;

    // Fall back to first available
    return filteredTemplates[0];
  }, [filteredTemplates, project?.defaultCaseExportTemplateId]);

  const effectiveTemplateId =
    selectedTemplateId || (defaultTemplate ? String(defaultTemplate.id) : "");

  const selectedTemplate = filteredTemplates?.find(
    (tmpl) => String(tmpl.id) === effectiveTemplateId
  );

  const groupedTemplates = useMemo(() => {
    if (!filteredTemplates || filteredTemplates.length === 0) return [];
    const groups = new Map<string, typeof filteredTemplates>();
    for (const tmpl of filteredTemplates) {
      const category = tmpl.category || "Other";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category)!.push(tmpl);
    }
    // Sort categories alphabetically, but put the default template's category first
    const defaultCategory = defaultTemplate?.category;
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === defaultCategory) return -1;
      if (b === defaultCategory) return 1;
      return a.localeCompare(b);
    });
  }, [filteredTemplates, defaultTemplate]);

  // Check AI availability when modal opens (GEN-02)
  useEffect(() => {
    if (isOpen) {
      setAiCheckLoading(true);
      checkAiExportAvailable({ projectId })
        .then((result) => {
          setAiAvailable(result.available);
          setHasCodeContext(result.hasCodeContext ?? false);
        })
        .catch(() => {
          setAiAvailable(false);
          setHasCodeContext(false);
        })
        .finally(() => {
          setAiCheckLoading(false);
        });
    }
  }, [isOpen, projectId]);

  // Reset AI state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setShowPreview(false);
      setPreviewResults([]);
      setAiEnabled(true);
      setGenerationProgress(null);
      setStreamingCode(null);
      setParallelProgress(null);
      fileAbortControllersRef.current.clear();
      fileStreamingRef.current = {};
      setFileStreamingSnippets({});
      if (streamingFlushRef.current) {
        clearInterval(streamingFlushRef.current);
        streamingFlushRef.current = null;
      }
      casesDataRef.current = [];
      isBatchModeRef.current = false;
      abortControllerRef.current = null;
    } else {
      // When modal opens, set output mode based on selection count
      setOutputMode(selectedCaseIds.length === 1 ? "single" : "individual");
    }
  }, [isOpen, selectedCaseIds.length]);

  // Download handler for preview pane
  const handlePreviewDownload = useCallback(async () => {
    if (previewResults.length === 0 || !selectedTemplate) return;

    try {
      if (outputMode === "single") {
        const combined = previewResults.map((r) => r.code).join("\n\n");
        const blob = new Blob([combined], {
          type: "text/plain;charset=utf-8;",
        });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        link.setAttribute(
          "download",
          `testplanit-export-${timestamp}${selectedTemplate.fileExtension}`
        );
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();

        previewResults.forEach((result) => {
          const filename = `${sanitizeFilename(result.caseName) || `case-${result.caseId}`}${selectedTemplate.fileExtension}`;
          zip.file(filename, result.code);
        });

        const zipBlob = await zip.generateAsync({ type: "blob" });
        const link = document.createElement("a");
        const url = URL.createObjectURL(zipBlob);
        link.setAttribute("href", url);
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        link.setAttribute("download", `testplanit-export-${timestamp}.zip`);
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }

      logDataExport({
        exportType: `${previewResults.some((r) => r.generatedBy === "ai") ? "AI Export" : "QuickScript"} (${selectedTemplate.name})`,
        entityType: "RepositoryCases",
        recordCount: previewResults.length,
        projectId,
      });

      toast.success(t("exportSuccess"));
      onClose();
    } catch (error) {
      console.error("AI export download failed:", error);
      toast.error(tExportModal("exportError"));
    }
  }, [
    previewResults,
    selectedTemplate,
    outputMode,
    projectId,
    onClose,
    t,
    tExportModal,
  ]);

  const handleCancelGeneration = useCallback(() => {
    cancelledRef.current = true;
    abortControllerRef.current?.abort();
    // Abort all per-file controllers
    for (const ac of fileAbortControllersRef.current.values()) {
      ac.abort();
    }
    fileAbortControllersRef.current.clear();
    setStreamingCode(null);
    setParallelProgress(null);
    setFileStreamingSnippets({});
    fileStreamingRef.current = {};
    if (streamingFlushRef.current) {
      clearInterval(streamingFlushRef.current);
      streamingFlushRef.current = null;
    }
    setIsExporting(false);
    setGenerationProgress(null);
    if (previewResults.length === 0) {
      // Nothing generated yet — go back to the export form
      setShowPreview(false);
    }
    // If results already exist, keep the preview open so the user can see them
  }, [previewResults.length]);

  const handleCancelFile = useCallback((caseId: number) => {
    const ac = fileAbortControllersRef.current.get(caseId);
    if (ac) {
      ac.abort();
    }
  }, []);

  // Retry handler — for batch mode regenerates the whole file; otherwise retries a single case
  const handleRetry = useCallback(
    async (caseId: number) => {
      if (!effectiveTemplateId) return;

      if (isBatchModeRef.current) {
        const result = await generateAiExportBatch({
          caseIds: selectedCaseIds,
          projectId,
          templateId: parseInt(effectiveTemplateId),
          cases: casesDataRef.current,
        });
        setPreviewResults([result]);
        return;
      }

      const idx = previewResults.findIndex((r) => r.caseId === caseId);
      if (idx === -1) return;

      const result = await generateAiExport({
        caseId,
        projectId,
        templateId: parseInt(effectiveTemplateId),
        caseData: casesDataRef.current[idx],
      });
      const updated = [...previewResults];
      updated[idx] = result;
      setPreviewResults(updated);
    },
    [previewResults, effectiveTemplateId, projectId, selectedCaseIds]
  );

  const handleExport = useCallback(async () => {
    if (!effectiveTemplateId || selectedCaseIds.length === 0) return;

    const template = filteredTemplates?.find(
      (t) => t.id === parseInt(effectiveTemplateId)
    );
    if (!template) return;

    const runId = ++exportRunIdRef.current;
    setIsExporting(true);

    try {
      // AI-enabled export path
      if (aiEnabled) {
        const response = await fetchCasesForQuickScript({
          caseIds: selectedCaseIds,
          projectId,
        });

        if (!response.success) {
          toast.error(response.error);
          return;
        }

        // Store case data for retry support
        casesDataRef.current = response.data;

        cancelledRef.current = false;
        setShowPreview(true);

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        // Single-file mode with multiple cases: one streaming LLM call for the whole file
        if (outputMode === "single" && response.data.length > 1) {
          isBatchModeRef.current = true;
          setStreamingCode("");
          try {
            const raw = await streamExportCase(
              {
                mode: "batch",
                caseIds: selectedCaseIds,
                projectId,
                templateId: parseInt(effectiveTemplateId),
                cases: response.data,
              },
              abortController.signal,
              (delta) => setStreamingCode((prev) => (prev ?? "") + delta)
            );
            setStreamingCode(null);
            setPreviewResults([
              {
                ...raw,
                caseId: selectedCaseIds[0],
                caseName: `Combined (${response.data.length} tests)`,
              },
            ]);
          } catch (err) {
            if ((err as DOMException)?.name === "AbortError") return;
            throw err;
          }
          return;
        }

        // Individual mode or single case: fire all LLM calls in parallel
        isBatchModeRef.current = false;

        // Build per-file progress list and abort controllers
        const fileProgressList: ParallelFileProgress[] = response.data.map(
          (c, i) => ({
            caseId: selectedCaseIds[i],
            caseName: c.name,
            status: "pending" as FileGenStatus,
          })
        );
        const fileAbortControllers = new Map<number, AbortController>();
        for (const caseId of selectedCaseIds) {
          fileAbortControllers.set(caseId, new AbortController());
        }
        fileAbortControllersRef.current = fileAbortControllers;
        fileStreamingRef.current = {};
        setFileStreamingSnippets({});
        setParallelProgress([...fileProgressList]);

        // Flush accumulated streaming chunks to state every 150ms
        streamingFlushRef.current = setInterval(() => {
          setFileStreamingSnippets({ ...fileStreamingRef.current });
        }, 150);

        // Helper to update a single file's status
        const updateFileStatus = (
          caseId: number,
          status: FileGenStatus,
          error?: string
        ) => {
          const idx = fileProgressList.findIndex((f) => f.caseId === caseId);
          if (idx !== -1) {
            fileProgressList[idx] = {
              ...fileProgressList[idx],
              status,
              error,
            };
            setParallelProgress([...fileProgressList]);
          }
        };

        // Fire all stream calls in parallel
        const promises = response.data.map((caseData, i) => {
          const caseId = selectedCaseIds[i];
          const fileAbort = fileAbortControllers.get(caseId)!;
          updateFileStatus(caseId, "generating");

          return streamExportCase(
            {
              mode: "single",
              caseId,
              projectId,
              templateId: parseInt(effectiveTemplateId),
              caseData,
            },
            fileAbort.signal,
            (delta) => {
              fileStreamingRef.current[caseId] =
                (fileStreamingRef.current[caseId] || "") + delta;
            }
          )
            .then((raw) => {
              updateFileStatus(caseId, "done");
              return {
                ...raw,
                caseId,
                caseName: caseData.name,
              } as AiExportResult;
            })
            .catch((err) => {
              if ((err as DOMException)?.name === "AbortError") {
                updateFileStatus(caseId, "error", tAi("cancelledGeneration"));
                return {
                  code: "",
                  generatedBy: "template" as const,
                  error: tAi("cancelledGeneration"),
                  caseId,
                  caseName: caseData.name,
                } as AiExportResult;
              }
              const msg =
                err instanceof Error ? err.message : "Generation failed";
              updateFileStatus(caseId, "error", msg);
              return {
                code: "",
                generatedBy: "template" as const,
                error: msg,
                caseId,
                caseName: caseData.name,
              } as AiExportResult;
            });
        });

        const results = await Promise.all(promises);
        if (streamingFlushRef.current) {
          clearInterval(streamingFlushRef.current);
          streamingFlushRef.current = null;
        }
        fileStreamingRef.current = {};
        setFileStreamingSnippets({});
        if (cancelledRef.current) return;

        setPreviewResults(results);
        setParallelProgress(null);
        fileAbortControllersRef.current.clear();
        return; // Do not auto-download -- user reviews in preview first
      }

      // Standard Mustache-only export path — render then show preview
      const response = await fetchCasesForQuickScript({
        caseIds: selectedCaseIds,
        projectId,
      });

      if (!response.success) {
        toast.error(response.error);
        return;
      }

      const cases = response.data;
      const Mustache = (await import("mustache")).default;
      Mustache.escape = (text: string) =>
        String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

      const renderedCases = cases.map((caseData: QuickScriptCaseData) => {
        return Mustache.render(template.templateBody, caseData);
      });

      const header = template.headerBody || "";
      const footer = template.footerBody || "";

      let results: AiExportResult[];

      if (outputMode === "single") {
        const combined = [header, ...renderedCases, footer]
          .filter(Boolean)
          .join("\n\n");
        results = [
          {
            code: combined,
            generatedBy: "template",
            caseId: cases[0].id,
            caseName: cases[0].name,
          },
        ];
      } else {
        results = cases.map((caseData: QuickScriptCaseData, index: number) => ({
          code: [header, renderedCases[index], footer]
            .filter(Boolean)
            .join("\n\n"),
          generatedBy: "template" as const,
          caseId: caseData.id,
          caseName: caseData.name,
        }));
      }

      setPreviewResults(results);
      setShowPreview(true);
    } catch (error) {
      console.error("Templated export failed:", error);
      const errorMessage =
        error instanceof Error ? error.message : tExportModal("exportError");
      toast.error(errorMessage);
      // Reset preview state so the user isn't stuck on an empty preview pane
      setStreamingCode(null);
      setGenerationProgress(null);
      setParallelProgress(null);
      fileAbortControllersRef.current.clear();
      fileStreamingRef.current = {};
      setFileStreamingSnippets({});
      if (streamingFlushRef.current) {
        clearInterval(streamingFlushRef.current);
        streamingFlushRef.current = null;
      }
      if (previewResults.length === 0) {
        setShowPreview(false);
      }
    } finally {
      // Only reset if this run is still the active one — prevents a stale
      // finally from a cancelled run overwriting a new run's isExporting=true.
      if (exportRunIdRef.current === runId) {
        setIsExporting(false);
      }
    }
  }, [
    effectiveTemplateId,
    selectedCaseIds,
    filteredTemplates,
    aiEnabled,
    projectId,
    outputMode,
    tAi,
    tExportModal,
    previewResults.length,
  ]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn(
          showPreview ? "sm:max-w-225 max-h-[95vh]" : "sm:max-w-125",
          "transition-all overflow-hidden"
        )}
        data-testid="quickscript-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {showPreview ? tAi("previewTitle") : t("title")}
          </DialogTitle>
          <DialogDescription>
            {showPreview
              ? tAi("previewDescription", {
                  count: previewResults.length,
                })
              : t("description")}
          </DialogDescription>
        </DialogHeader>

        {showPreview ? (
          <ExportPreviewPane
            results={previewResults}
            language={selectedTemplate?.language || ""}
            isGenerating={isExporting}
            progress={generationProgress || undefined}
            batchCount={
              isBatchModeRef.current ? selectedCaseIds.length : undefined
            }
            streamingCode={streamingCode}
            parallelProgress={parallelProgress}
            fileStreamingSnippets={fileStreamingSnippets}
            onRetry={handleRetry}
            onCancel={handleCancelGeneration}
            onCancelFile={handleCancelFile}
            onDownload={handlePreviewDownload}
            onClose={() => setShowPreview(false)}
          />
        ) : (
          <>
            <div className="space-y-6 py-4">
              <div className="space-y-2">
                <Label>{tCommon("fields.template")}</Label>
                {assignmentsExistButEmpty ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    {t("noAvailableTemplates")}
                  </p>
                ) : (
                  <Popover open={comboboxOpen} onOpenChange={setComboboxOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={comboboxOpen}
                        className="w-full justify-between font-normal"
                        data-testid="quickscript-template-select"
                      >
                        <span className="flex items-center gap-1.5">
                          {selectedTemplate
                            ? selectedTemplate.name
                            : t("templatePlaceholder")}
                          {selectedTemplate?.isDefault && (
                            <TooltipProvider delayDuration={300}>
                              <Tooltip>
                                <TooltipTrigger className="ml-1" asChild>
                                  <Badge variant="secondary">
                                    <Star className="h-3 w-3 fill-current text-primary-background" />
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {tCommon("defaultOption")}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                      <Command>
                        <CommandInput
                          placeholder={t("searchPlaceholder")}
                          data-testid="quickscript-template-search"
                        />
                        <CommandList onWheel={(e) => e.stopPropagation()}>
                          <CommandEmpty>{t("noTemplatesFound")}</CommandEmpty>
                          {groupedTemplates.map(
                            ([category, categoryTemplates]) => (
                              <CommandGroup heading={category} key={category}>
                                {categoryTemplates.map((tmpl) => (
                                  <CommandItem
                                    key={tmpl.id}
                                    value={`${tmpl.name} ${tmpl.category} ${tmpl.framework}`}
                                    onSelect={() => {
                                      setSelectedTemplateId(String(tmpl.id));
                                      setComboboxOpen(false);
                                    }}
                                    data-testid={`template-option-${tmpl.id}`}
                                  >
                                    <Check
                                      className={cn(
                                        "mr-2 h-4 w-4",
                                        effectiveTemplateId === String(tmpl.id)
                                          ? "opacity-100"
                                          : "opacity-0"
                                      )}
                                    />
                                    {tmpl.name}
                                    {tmpl.isDefault && (
                                      <TooltipProvider delayDuration={300}>
                                        <Tooltip>
                                          <TooltipTrigger
                                            className="ml-1"
                                            asChild
                                          >
                                            <Badge variant="secondary">
                                              <Star className="h-3 w-3 fill-current text-primary-background" />
                                            </Badge>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            {tCommon("defaultOption")}
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    )}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            )
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                )}
              </div>

              <div className="space-y-2">
                <Label>{t("outputModeLabel")}</Label>
                <RadioGroup
                  value={outputMode}
                  onValueChange={(v) =>
                    setOutputMode(v as "single" | "individual")
                  }
                  data-testid="quickscript-output-mode"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="individual"
                      id="individual"
                      disabled={selectedCaseIds.length === 1}
                    />
                    <Label
                      htmlFor="individual"
                      className={cn(
                        selectedCaseIds.length === 1 && "text-muted-foreground"
                      )}
                    >
                      {t("outputModeIndividual", {
                        count: selectedCaseIds.length,
                      })}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="single" id="single" />
                    <Label htmlFor="single">
                      {t("outputModeSingle", {
                        count: selectedCaseIds.length,
                      })}
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* AI toggle - visible when LLM is configured (GEN-02) */}
              {aiAvailable && !aiCheckLoading && (
                <div
                  className="rounded-lg border p-3"
                  data-testid="ai-export-toggle"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <Label htmlFor="ai-toggle" className="cursor-pointer">
                        {tAi("toggleLabel")}
                      </Label>
                    </div>
                    <Switch
                      id="ai-toggle"
                      checked={aiEnabled}
                      onCheckedChange={setAiEnabled}
                    />
                  </div>
                  {!hasCodeContext && aiEnabled && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {tAi("noCodeContextHint")}
                    </p>
                  )}
                </div>
              )}

              <div className="text-sm text-muted-foreground">
                {t("casesToExport", { count: selectedCaseIds.length })}
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isExporting}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="button"
                onClick={handleExport}
                disabled={
                  isExporting ||
                  !effectiveTemplateId ||
                  assignmentsExistButEmpty
                }
                data-testid="quickscript-button"
              >
                {isExporting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {tExportModal("exporting")}
                  </>
                ) : (
                  tCases("export")
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
