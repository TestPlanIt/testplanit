"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import {
  ActionButtonContent,
  collapsibleActionClass,
} from "@/components/ui/action-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  PageCardHeader,
  ProjectHeaderInfo,
} from "@/components/ui/page-card-header";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DuplicateResultsTable } from "@/components/duplicates/DuplicateResultsTable";
import { Loader2, RefreshCw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const STORAGE_KEY_PREFIX = "duplicate-scan-job:";

export default function DuplicatesPage() {
  const t = useTranslations("repository.duplicates");
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const storageKey = `${STORAGE_KEY_PREFIX}${projectId}`;

  // `name` + `iconUrl` feed the standard project line under the page title.
  const { data: project } = useClientQueries(schema).projects.useFindUnique({
    where: { id: parseInt(projectId) },
    select: { name: true, iconUrl: true },
  });

  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{
    analyzed: number;
    total: number;
  } | null>(null);
  const pollingRef = useRef(false);
  const jobIdRef = useRef<string | null>(null);

  const handleCancel = useCallback(async () => {
    const jobId = jobIdRef.current;
    if (!jobId) return;
    try {
      await fetch(`/api/duplicate-scan/cancel/${jobId}`, { method: "POST" });
    } catch {
      /* ignore */
    }
    sessionStorage.removeItem(storageKey);
    setIsScanning(false);
    setScanProgress(null);
    pollingRef.current = false;
    jobIdRef.current = null;
  }, [storageKey]);

  const startPolling = useCallback(
    (jobId: string) => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      jobIdRef.current = jobId;
      setIsScanning(true);

      const poll = async () => {
        try {
          const statusRes = await fetch(`/api/duplicate-scan/status/${jobId}`);
          if (!statusRes.ok) {
            // Job no longer exists (obliterated/expired)
            sessionStorage.removeItem(storageKey);
            setIsScanning(false);
            setScanProgress(null);
            pollingRef.current = false;
            return;
          }
          const status = await statusRes.json();
          if (!status.state || status.state === "unknown") {
            // Job disappeared
            sessionStorage.removeItem(storageKey);
            setIsScanning(false);
            setScanProgress(null);
            pollingRef.current = false;
            return;
          }
          if (status.progress) {
            setScanProgress(status.progress);
          }
          if (status.state === "completed") {
            toast.success(
              t("scanComplete", {
                count: status.result?.pairsFound ?? 0,
              })
            );
            void queryClient.invalidateQueries({
              queryKey: ["duplicate-scan-candidates", projectId],
            });
            sessionStorage.removeItem(storageKey);
            setIsScanning(false);
            setScanProgress(null);
            pollingRef.current = false;
          } else if (status.state === "failed") {
            toast.error(t("scanFailed"), {
              description: status.failedReason,
            });
            sessionStorage.removeItem(storageKey);
            setIsScanning(false);
            setScanProgress(null);
            pollingRef.current = false;
          } else {
            setTimeout(poll, 2500);
          }
        } catch {
          sessionStorage.removeItem(storageKey);
          setIsScanning(false);
          setScanProgress(null);
          pollingRef.current = false;
        }
      };
      void poll();
    },
    [projectId, queryClient, storageKey, t]
  );

  // On mount, check for an active scan in sessionStorage
  useEffect(() => {
    const savedJobId = sessionStorage.getItem(storageKey);
    if (savedJobId) {
      startPolling(savedJobId);
    }
  }, [storageKey, startPolling]);

  const handleRescan = async () => {
    setIsScanning(true);
    try {
      const res = await fetch("/api/duplicate-scan/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: parseInt(projectId) }),
      });
      if (!res.ok) {
        toast.error(t("scanFailed"));
        setIsScanning(false);
        return;
      }
      const { jobId } = await res.json();
      sessionStorage.setItem(storageKey, jobId);
      startPolling(jobId);
    } catch {
      toast.error(t("scanFailed"));
      setIsScanning(false);
    }
  };

  return (
    <main data-testid="duplicates-page">
      <Card>
        <PageCardHeader
          className="w-full"
          title={t("pageTitle")}
          helpKey="repositoryDuplicates"
          backHref={`/projects/repository/${projectId}`}
          description={<ProjectHeaderInfo project={project} />}
          actions={
            <>
              {isScanning && (
                <div className="flex items-center gap-2">
                  {scanProgress &&
                    scanProgress.total > 0 &&
                    ((scanProgress as any).phase === "ai" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {t("aiAnalyzing")}
                        </span>
                      </>
                    ) : (
                      <>
                        <Progress
                          value={Math.round(
                            (scanProgress.analyzed / scanProgress.total) * 100
                          )}
                          className="w-32 h-2"
                        />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {t("analyzing", {
                            analyzed: scanProgress.analyzed,
                            total: scanProgress.total,
                          })}
                        </span>
                      </>
                    ))}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={handleCancel}
                        aria-label={t("cancelScan")}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("cancelScan")}</TooltipContent>
                  </Tooltip>
                </div>
              )}
              <Button
                variant="outline"
                onClick={handleRescan}
                disabled={isScanning}
                className={collapsibleActionClass()}
              >
                <ActionButtonContent
                  icon={isScanning ? Loader2 : RefreshCw}
                  iconClassName={
                    isScanning
                      ? "h-4 w-4 shrink-0 animate-spin"
                      : "h-4 w-4 shrink-0"
                  }
                  label={t("rescan")}
                />
              </Button>
            </>
          }
        />
        <CardContent>
          <DuplicateResultsTable projectId={projectId} />
        </CardContent>
      </Card>
    </main>
  );
}
