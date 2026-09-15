"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Eye, Loader2, Plus, Trash, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { type Control, useFieldArray } from "react-hook-form";
import * as z from "zod/v4";
import type {
  RepoPreviewProgress,
  RepoPreviewResult,
} from "~/hooks/useRepoPreviewFiles";

export interface PathPatternValue {
  path: string;
  pattern: string;
}

/**
 * The `pathPatterns` field of a code repository configuration form. A blank
 * path (or ".") means the repository root; the pattern is required.
 */
export function pathPatternsSchema(tRepo: (key: string) => string) {
  return z
    .array(
      z.object({
        path: z.string().trim(),
        pattern: z.string().trim().min(1, tRepo("validation.patternRequired")),
      })
    )
    .min(1, tRepo("validation.pathPatternRequired"));
}

interface PathPatternsCardProps {
  control: Control<any>;
  /** Purpose-specific text under the card title. */
  description: string;
  pathPlaceholder: string;
  /** Pattern a new row starts with, and the pattern input's placeholder. */
  defaultPattern: string;
  readOnly?: boolean;
  /** Prefix for the row, add, and preview test ids. */
  testIdPrefix: string;
  isPreviewing: boolean;
  preview: RepoPreviewResult | null;
  previewProgress: RepoPreviewProgress | null;
  previewDisabled?: boolean;
  onPreview: () => void;
  /** Rendered under the preview summary, e.g. a size-limit warning. */
  previewExtras?: ReactNode;
}

/**
 * Path + glob rows that scope which repository files a configuration works
 * with, plus the Preview Files action. Shared by the QuickScript and Impact
 * repository settings so the rules for a row live in one place.
 */
export function PathPatternsCard({
  control,
  description,
  pathPlaceholder,
  defaultPattern,
  readOnly = false,
  testIdPrefix,
  isPreviewing,
  preview,
  previewProgress,
  previewDisabled = false,
  onPreview,
  previewExtras,
}: PathPatternsCardProps) {
  const tRepo = useTranslations("projects.settings.codeRepository");
  const tCommon = useTranslations("common");
  const { fields, append, remove } = useFieldArray({
    control,
    name: "pathPatterns",
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tRepo("pathPatterns.title")}</CardTitle>
        <CardDescription>
          {description} {tRepo("pathPatterns.rootHint")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {fields.map((row, index) => (
          <div key={row.id} className="flex items-start gap-2">
            <FormField
              control={control}
              name={`pathPatterns.${index}.path`}
              render={({ field }) => (
                <FormItem className="flex-1">
                  {index === 0 && (
                    <FormLabel>{tRepo("pathPatterns.pathLabel")}</FormLabel>
                  )}
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={pathPlaceholder}
                      data-testid={`${testIdPrefix}-path-${index}`}
                      disabled={readOnly}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name={`pathPatterns.${index}.pattern`}
              render={({ field }) => (
                <FormItem className="flex-1">
                  {index === 0 && (
                    <FormLabel>{tRepo("pathPatterns.patternLabel")}</FormLabel>
                  )}
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={defaultPattern}
                      data-testid={`${testIdPrefix}-pattern-${index}`}
                      disabled={readOnly}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={index === 0 ? "mt-8" : ""}
              onClick={() => remove(index)}
              disabled={readOnly || fields.length === 1}
              aria-label={tCommon("actions.delete")}
            >
              <Trash className="h-4 w-4" />
            </Button>
          </div>
        ))}

        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ path: "", pattern: defaultPattern })}
            data-testid={`${testIdPrefix}-add-path`}
          >
            <Plus className="h-4 w-4" />
            {tRepo("pathPatterns.addPath")}
          </Button>
        )}

        <div className="flex items-center gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onPreview}
            disabled={isPreviewing || previewDisabled}
            data-testid={`${testIdPrefix}-preview-button`}
          >
            {isPreviewing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
            {tRepo("pathPatterns.previewFiles")}
          </Button>
          {isPreviewing && previewProgress && (
            <span className="text-sm text-muted-foreground">
              {previewProgress.step === "branch" &&
                tRepo("preview.resolvingBranch")}
              {previewProgress.step === "listing" &&
                (previewProgress.filesFound != null
                  ? tRepo("preview.scanningFilesCount", {
                      count: previewProgress.filesFound,
                      scope: previewProgress.scope ?? "",
                    })
                  : tRepo("preview.scanningFiles", {
                      scope: previewProgress.scope ?? "",
                    }))}
              {previewProgress.step === "filtering" &&
                tRepo("preview.filtering", {
                  count: previewProgress.totalFiles ?? 0,
                })}
              {previewProgress.step === "rate-limited" &&
                tRepo("preview.rateLimited", {
                  seconds: previewProgress.waitSeconds ?? 0,
                })}
            </span>
          )}
        </div>

        {preview && !preview.error && (
          <div className="space-y-3">
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>
                {tRepo("pathPatterns.files", { count: preview.fileCount })}
              </span>
              <span>{preview.totalSizeFormatted}</span>
              {preview.truncated && (
                <Badge variant="secondary">
                  {tRepo("pathPatterns.truncatedBadge")}
                </Badge>
              )}
            </div>

            {previewExtras}

            <ScrollArea className="h-48 rounded-md border p-3">
              <div className="space-y-1">
                {preview.files.map((f) => (
                  <div
                    key={f.path}
                    className="font-mono text-xs text-muted-foreground"
                  >
                    {f.path}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {preview?.error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{preview.error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
