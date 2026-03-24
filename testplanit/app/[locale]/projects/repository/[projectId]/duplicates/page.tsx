"use client";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { DuplicateResultsTable } from "@/components/duplicates/DuplicateResultsTable";
import { ArrowLeft, CopyCheck, Loader2, RefreshCw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Link } from "~/lib/navigation";

const STORAGE_KEY_PREFIX = "duplicate-scan-job:";

export default function DuplicatesPage() {
  const t = useTranslations("repository.duplicates");
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const storageKey = `${STORAGE_KEY_PREFIX}${projectId}`;

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
            queryClient.invalidateQueries({
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
      poll();
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
    <div className="py-6 px-2">
      <div className="mb-6 flex items-center gap-2">
        <Link href={`/projects/repository/${projectId}`}>
          <Button variant="outline" size="icon" className="mr-2">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex gap-1">
            <CopyCheck className="w-6 h-6 shrink-0" />
            {t("pageTitle")}
          </h1>
          <p className="text-muted-foreground">{t("pageDescription")}</p>
        </div>
        <div className="flex items-center gap-3">
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
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleCancel}
                title={t("cancelScan")}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          <Button
            variant="outline"
            onClick={handleRescan}
            disabled={isScanning}
          >
            {isScanning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t("rescan")}
          </Button>
        </div>
      </div>
      <DuplicateResultsTable projectId={projectId} />
    </div>
  );
}
