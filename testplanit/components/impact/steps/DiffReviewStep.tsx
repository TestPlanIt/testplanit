"use client";

import { DiffView } from "@/components/code/DiffView";
import LoadingSpinner from "@/components/LoadingSpinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  Info,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Fragment } from "react";
import { codeLanguageFromPath } from "~/lib/utils/codeLanguageFromPath";
import { cn } from "~/utils";
import type { CommitRef } from "../CommitPicker";
import type {
  CompareErrorCode,
  CompareFile,
  CompareFileStatus,
  CompareResponse,
} from "../ImpactDialog";

const STATUS_KEY: Record<CompareFileStatus, string> = {
  added: "diff.statusAdded",
  modified: "diff.statusModified",
  deleted: "diff.statusRemoved",
  renamed: "diff.statusRenamed",
};

const STATUS_CLASS: Record<CompareFileStatus, string> = {
  added: "border-green-600/40 text-green-700 dark:text-green-400",
  modified: "border-amber-600/40 text-amber-700 dark:text-amber-400",
  deleted: "border-red-600/40 text-red-700 dark:text-red-400",
  renamed: "border-sky-600/40 text-sky-700 dark:text-sky-400",
};

const ERROR_KEY: Record<CompareErrorCode, string> = {
  sameCommit: "pick.sameCommit",
  refNotFound: "pick.refNotFound",
  compareFailed: "errors.compareFailed",
};

interface DiffReviewStepProps {
  compare: CompareResponse | null;
  loading: boolean;
  error: CompareErrorCode | null;
  swapped: boolean;
  base: CommitRef | null;
  head: CommitRef | null;
  expandedIndex: number | null;
  onToggleFile: (index: number) => void;
}

function FilePatch({ file }: { file: CompareFile }) {
  const t = useTranslations("runs.impact");
  if (file.isBinary) {
    return (
      <p className="px-4 py-3 text-sm text-muted-foreground">
        {t("diff.binary")}
      </p>
    );
  }
  if (!file.patch) {
    return (
      <p className="px-4 py-3 text-sm text-muted-foreground">
        {t("diff.noPatch")}
      </p>
    );
  }
  return (
    <div className="space-y-2 py-2">
      <div className="max-h-[50vh] overflow-auto">
        <DiffView
          patch={file.patch}
          language={codeLanguageFromPath(file.path)}
        />
      </div>
      {file.patchTruncated && (
        <p
          className="px-4 text-xs text-muted-foreground"
          data-testid="impact-diff-truncated"
        >
          {t("diff.truncated")}
        </p>
      )}
    </div>
  );
}

export function DiffReviewStep({
  compare,
  loading,
  error,
  swapped,
  base,
  head,
  expandedIndex,
  onToggleFile,
}: DiffReviewStepProps) {
  const t = useTranslations("runs.impact");
  const locale = useLocale();

  if (error) {
    return (
      <Alert variant="destructive" className="my-2">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>{t("errors.title")}</AlertTitle>
        <AlertDescription>{t(ERROR_KEY[error])}</AlertDescription>
      </Alert>
    );
  }

  if (loading || !compare) {
    return (
      <div className="flex flex-col items-center justify-center space-y-3 py-12">
        <LoadingSpinner className="h-8 w-8" delay={0} />
        <p className="text-sm text-muted-foreground">{t("diff.loading")}</p>
      </div>
    );
  }

  const additions = compare.files.reduce(
    (sum, file) => sum + file.additions,
    0
  );
  const deletions = compare.files.reduce(
    (sum, file) => sum + file.deletions,
    0
  );

  return (
    <div className="space-y-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <code>{base?.shortSha ?? compare.baseSha.slice(0, 7)}</code>
          <ArrowLeftRight className="h-3.5 w-3.5" />
          <code>{head?.shortSha ?? compare.headSha.slice(0, 7)}</code>
        </div>
        <p className="font-medium" data-testid="impact-diff-summary">
          {t("diff.summary", {
            files: compare.files.length,
            additions,
            deletions,
          })}
        </p>
      </div>

      {swapped && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>{t("pick.swapped")}</AlertDescription>
        </Alert>
      )}

      {compare.truncated && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{t("diff.truncated")}</AlertDescription>
        </Alert>
      )}

      {compare.files.length === 0 ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>{t("diff.noChanges")}</AlertDescription>
        </Alert>
      ) : (
        <div className="rounded-md border">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-28" />
                <TableHead />
                <TableHead className="w-32 text-end" />
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {compare.files.map((file, index) => {
                const expanded = expandedIndex === index;
                return (
                  <Fragment key={`${file.path}-${index}`}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => onToggleFile(index)}
                      aria-expanded={expanded}
                      data-testid={`impact-diff-file-${index}`}
                    >
                      <TableCell className="py-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            "whitespace-nowrap",
                            STATUS_CLASS[file.status]
                          )}
                        >
                          {t(STATUS_KEY[file.status])}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2">
                        <div
                          className="truncate font-mono text-xs"
                          title={file.path}
                        >
                          {file.status === "renamed" && file.previousPath ? (
                            <>
                              <span className="text-muted-foreground">
                                {file.previousPath}
                              </span>
                              <span className="mx-1 text-muted-foreground">
                                {"→"}
                              </span>
                              {file.path}
                            </>
                          ) : (
                            file.path
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-2 text-end font-mono text-xs whitespace-nowrap">
                        <span className="text-green-700 dark:text-green-400">
                          {"+"}
                          {file.additions.toLocaleString(locale)}
                        </span>{" "}
                        <span className="text-red-700 dark:text-red-400">
                          {"−"}
                          {file.deletions.toLocaleString(locale)}
                        </span>
                      </TableCell>
                      <TableCell className="py-2">
                        {expanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow data-testid={`impact-diff-patch-${index}`}>
                        <TableCell colSpan={4} className="bg-muted/30 p-0">
                          <FilePatch file={file} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
