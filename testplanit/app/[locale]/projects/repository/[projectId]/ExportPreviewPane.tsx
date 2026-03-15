"use client";

import { useTranslations } from "next-intl";
import "prismjs/themes/prism-tomorrow.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { highlightCode, mapLanguageToPrism } from "~/lib/utils/codeHighlight";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import {
  AlertTriangle, Check, ChevronDown, Circle, Copy,
  Download, FileCode,
  HelpCircle, Loader2, RefreshCw, X
} from "lucide-react";
import type { AiExportResult } from "~/app/actions/aiExportActions";
import type { ParallelFileProgress } from "./QuickScriptModal";

interface ExportPreviewPaneProps {
  results: AiExportResult[];
  language: string;
  isGenerating: boolean;
  progress?: { current: number; total: number };
  batchCount?: number; // Set when generating all cases as a single file
  streamingCode?: string | null; // Live code content while streaming
  parallelProgress?: ParallelFileProgress[] | null;
  fileStreamingSnippets?: Record<number, string>;
  onRetry?: (caseId: number) => void;
  onCancel?: () => void;
  onCancelFile?: (caseId: number) => void;
  onDownload: () => void;
  onClose: () => void;
}

export function ExportPreviewPane({
  results,
  language,
  isGenerating,
  progress,
  batchCount,
  streamingCode,
  parallelProgress,
  fileStreamingSnippets,
  onRetry,
  onCancel,
  onCancelFile,
  onDownload,
  onClose,
}: ExportPreviewPaneProps) {
  const t = useTranslations("repository.aiExport");
  const tCommon = useTranslations("common");
  const [copied, setCopied] = useState(false);
  const [retryingCaseId, setRetryingCaseId] = useState<number | null>(null);
  const [copiedCaseId, setCopiedCaseId] = useState<number | null>(null);

  const prismLanguage = useMemo(() => mapLanguageToPrism(language), [language]);

  const handleCopy = useCallback(async () => {
    const text =
      results.length === 1
        ? results[0].code
        : results
            .map((r) => `// === ${r.caseName} ===\n${r.code}`)
            .join("\n\n");

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(t("copySuccess"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  }, [results, t]);

  const handleRetry = useCallback(
    async (caseId: number) => {
      if (!onRetry) return;
      setRetryingCaseId(caseId);
      try {
        await onRetry(caseId);
      } finally {
        setRetryingCaseId(null);
      }
    },
    [onRetry]
  );

  const hasStreamingContent = streamingCode != null && streamingCode.length > 0;

  // Ref attached to the active scrollable container (full-screen or multi-result).
  // Only one is rendered at a time so the same ref works for both.
  const streamingScrollRef = useRef<HTMLDivElement>(null);

  // Scroll to the bottom of the container whenever a new chunk arrives
  useEffect(() => {
    if (hasStreamingContent && streamingScrollRef.current) {
      const el = streamingScrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [streamingCode, hasStreamingContent]);

  // Parallel generation: show file list with per-file status indicators
  if (parallelProgress && parallelProgress.length > 0) {
    const doneCount = parallelProgress.filter(
      (f) => f.status === "done" || f.status === "error"
    ).length;
    const totalCount = parallelProgress.length;

    return (
      <div className="space-y-4 overflow-hidden w-full">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {t("generatingParallelProgress", {
              done: doneCount,
              total: totalCount,
            })}
          </p>
          {onCancel && (
            <Button variant="outline" size="sm" onClick={onCancel}>
              {tCommon("cancel")}
            </Button>
          )}
        </div>

        <div className="space-y-1.5 overflow-y-auto overflow-x-hidden">
          {parallelProgress.map((file) => {
            const snippet = fileStreamingSnippets?.[file.caseId];
            return (
              <div
                key={file.caseId}
                className="rounded-md border overflow-hidden"
              >
                <div className="flex items-center gap-3 px-3 py-2 min-w-0">
                  {file.status === "pending" && (
                    <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                  )}
                  {file.status === "generating" && (
                    <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                  )}
                  {file.status === "done" && (
                    <Check className="h-4 w-4 text-success shrink-0" />
                  )}
                  {file.status === "error" && (
                    <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <FileCode className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm truncate flex-1 min-w-0">
                    {file.caseName}
                  </span>
                  {file.status === "error" && file.error && (
                    <span className="text-xs text-destructive truncate max-w-40">
                      {file.error}
                    </span>
                  )}
                  {(file.status === "generating" ||
                    file.status === "pending") &&
                    onCancelFile && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        onClick={() => onCancelFile(file.caseId)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                </div>
                {file.status === "generating" && snippet && (
                  <pre className="bg-stone-800 text-muted-foreground text-[11px] leading-tight px-3 py-1.5 max-h-14 overflow-hidden border-t">
                    <code>{snippet.slice(-300)}</code>
                  </pre>
                )}
              </div>
            );
          })}
        </div>

        {/* Progress bar */}
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${(doneCount / totalCount) * 100}%` }}
          />
        </div>
      </div>
    );
  }

  // Spinner: generating but streaming hasn't produced any text yet
  if (isGenerating && results.length === 0 && !hasStreamingContent) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {batchCount != null
            ? t("generatingBatch", { count: batchCount })
            : progress
              ? t("generatingProgress", {
                  current: progress.current,
                  total: progress.total,
                })
              : t("generating")}
        </p>
        {onCancel && (
          <Button variant="outline" size="sm" onClick={onCancel}>
            {tCommon("cancel")}
          </Button>
        )}
      </div>
    );
  }

  // Nothing to show
  if (results.length === 0 && !hasStreamingContent) {
    return null;
  }

  return (
    <div className="space-y-4 min-w-0">
      {/* Code display */}
      {results.length === 0 && hasStreamingContent ? (
        // Streaming first result — show full-width live code view
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>{t("generating")}</span>
            </div>
            {onCancel && (
              <Button variant="outline" size="sm" onClick={onCancel}>
                {tCommon("cancel")}
              </Button>
            )}
          </div>
          <div
            ref={streamingScrollRef}
            className="max-h-[70vh] overflow-y-auto"
          >
            <CodeBlock code={streamingCode!} prismLanguage={prismLanguage} />
          </div>
        </div>
      ) : results.length === 1 && !hasStreamingContent ? (
        // Single completed result
        <SingleResultView
          result={results[0]}
          prismLanguage={prismLanguage}
          onRetry={onRetry ? () => handleRetry(results[0].caseId) : undefined}
          isRetrying={retryingCaseId === results[0].caseId}
          t={t}
        />
      ) : (
        // Multiple completed results and/or a case currently streaming
        <div ref={streamingScrollRef} className="max-h-[70vh] overflow-y-auto">
          <div className="space-y-4">
            {results.map((result, index) => (
              <div key={result.caseId}>
                <div className="flex items-center justify-between mb-2 min-w-0">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <FileCode className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate">
                      {result.caseName}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge
                      variant={
                        result.generatedBy === "ai" ? "default" : "secondary"
                      }
                      className="flex items-center gap-1 ml-2"
                    >
                      {result.generatedBy === "ai"
                        ? t("aiGenerated")
                        : t("templateGenerated")}
                      {result.generatedBy === "template" && result.error && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="h-4 w-4 shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs">
                              {result.error}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </Badge>
                    {results.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(result.code);
                            setCopiedCaseId(result.caseId);
                            toast.success(t("copySuccess"));
                            setTimeout(() => setCopiedCaseId(null), 2000);
                          } catch {
                            toast.error("Failed to copy to clipboard");
                          }
                        }}
                      >
                        {copiedCaseId === result.caseId ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    )}
                    {result.generatedBy === "template" && onRetry && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRetry(result.caseId)}
                        disabled={retryingCaseId === result.caseId}
                        className="h-7 px-2"
                      >
                        {retryingCaseId === result.caseId ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
                <CodeBlock code={result.code} prismLanguage={prismLanguage} />
                {result.truncated && (
                  <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {t("truncatedWarning")}
                  </div>
                )}
                {result.contextFiles && result.contextFiles.length > 0 && (
                  <ContextFilesList files={result.contextFiles} />
                )}
                {(index < results.length - 1 || hasStreamingContent) && (
                  <Separator className="mt-4" />
                )}
              </div>
            ))}
            {/* Next case currently streaming */}
            {hasStreamingContent && (
              <div>
                <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>{t("generating")}</span>
                </div>
                <CodeBlock
                  code={streamingCode!}
                  prismLanguage={prismLanguage}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Progress bar during per-case generation (not shown during streaming code display) */}
      {isGenerating && progress && !hasStreamingContent && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>
              {t("generatingProgress", {
                current: progress.current,
                total: progress.total,
              })}
            </span>
          </div>
          {onCancel && (
            <Button variant="outline" size="sm" onClick={onCancel}>
              {tCommon("cancel")}
            </Button>
          )}
        </div>
      )}

      {/* Action buttons */}
      {!isGenerating && (
        <div className="flex items-center justify-between pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("backButton")}
          </Button>
          <div className="flex items-center gap-2">
            {results.length <= 1 && (
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {t("copyButton")}
              </Button>
            )}
            <Button size="sm" onClick={onDownload}>
              <Download className="h-4 w-4" />
              {t("downloadButton")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Single result view with fallback badge and retry button.
 */
function SingleResultView({
  result,
  prismLanguage,
  onRetry,
  isRetrying,
  t,
}: {
  result: AiExportResult;
  prismLanguage: string;
  onRetry?: () => void;
  isRetrying: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="relative">
      {result.generatedBy === "template" && (
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="secondary" className="flex items-center gap-1">
            {t("fallbackBadge")}
            {result.error && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-4 w-4 shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    {result.error}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </Badge>
          {onRetry && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRetry}
              disabled={isRetrying}
              className="h-7 px-2"
              title={t("retryButton")}
            >
              {isRetrying ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              <span className="ml-1 text-xs">{t("retryButton")}</span>
            </Button>
          )}
        </div>
      )}
      {result.truncated && (
        <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-xs">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {t("truncatedWarning")}
        </div>
      )}
      <div className="max-h-[70vh] overflow-y-auto">
        <CodeBlock code={result.code} prismLanguage={prismLanguage} />
      </div>
      {result.contextFiles && result.contextFiles.length > 0 && (
        <ContextFilesList files={result.contextFiles} />
      )}
    </div>
  );
}

/**
 * Syntax-highlighted code block using PrismJS with dangerouslySetInnerHTML.
 */
function CodeBlock({
  code,
  prismLanguage,
}: {
  code: string;
  prismLanguage: string;
}) {
  const html = useMemo(
    () => highlightCode(code, prismLanguage),
    [code, prismLanguage]
  );

  return (
    <pre className="bg-stone-800 rounded-md overflow-auto p-4 text-sm max-w-full">
      <code
        className={`language-${prismLanguage}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </pre>
  );
}

/**
 * Collapsible list of repository files included in AI context.
 * Collapsed by default. Only renders when contextFiles is non-empty.
 */
function ContextFilesList({ files }: { files: string[] }) {
  const t = useTranslations("repository.aiExport");
  if (files.length === 0) return null;
  return (
    <Collapsible className="mt-2">
      <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ChevronDown className="h-3 w-3" />
        {t("contextFiles", { count: files.length })}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1 space-y-0.5 pl-4">
          {files.map((f) => (
            <li
              key={f}
              className="text-xs text-muted-foreground font-mono truncate"
            >
              {f}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
