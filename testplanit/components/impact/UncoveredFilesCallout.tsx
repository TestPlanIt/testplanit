"use client";

import { AddCodePinDialog } from "@/components/impact/AddCodePinDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileWarning, Pin } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

export interface UncoveredFilesCalloutProps {
  projectId: number;
  configId: number;
  repositoryId: number;
  files: string[];
  /** Paths already pinned from this callout, mapped to the case they were pinned to. */
  pinned: Record<string, number>;
  onPinned: (path: string, caseId: number) => void;
}

export function UncoveredFilesCallout({
  projectId,
  configId,
  repositoryId,
  files,
  pinned,
  onPinned,
}: UncoveredFilesCalloutProps) {
  const t = useTranslations("runs.impact");
  const [pinTarget, setPinTarget] = useState<string | null>(null);

  if (files.length === 0) return null;

  return (
    <>
      <Alert data-testid="impact-uncovered">
        <FileWarning className="h-4 w-4" />
        <AlertTitle>{t("uncovered.title", { count: files.length })}</AlertTitle>
        <AlertDescription>
          <p>{t("uncovered.description")}</p>
          <ul className="mt-2 space-y-1">
            {files.map((path, index) => {
              const pinnedCaseId = pinned[path];
              return (
                <li
                  key={path}
                  className="flex items-center justify-between gap-2"
                  data-testid={`impact-uncovered-file-${index}`}
                >
                  <code className="truncate font-mono text-xs">{path}</code>
                  {pinnedCaseId !== undefined ? (
                    <Badge variant="secondary" className="shrink-0">
                      <Pin className="me-1 h-3 w-3" />
                      {t("uncovered.pinned")}
                    </Badge>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setPinTarget(path)}
                      data-testid={`impact-uncovered-pin-${index}`}
                    >
                      <Pin className="h-4 w-4" />
                      {t("uncovered.pinAction")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </AlertDescription>
      </Alert>
      {pinTarget !== null && (
        <AddCodePinDialog
          open
          onOpenChange={(open) => {
            if (!open) setPinTarget(null);
          }}
          projectId={projectId}
          configId={configId}
          repositoryId={repositoryId}
          initialFilePath={pinTarget}
          initialKind="FILE"
          onCreated={(_pin, caseId) => {
            onPinned(pinTarget, caseId);
            setPinTarget(null);
          }}
        />
      )}
    </>
  );
}
