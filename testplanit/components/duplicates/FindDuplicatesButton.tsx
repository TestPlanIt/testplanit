"use client";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useQuery } from "@tanstack/react-query";
import { CopyCheck, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "~/lib/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type ScanState = "idle" | "active" | "complete" | "failed";

interface StatusData {
  jobId: string;
  state: string;
  progress: { analyzed: number; total: number } | null;
  result: {
    pairsFound: number;
    casesScanned: number;
    scanJobId: number;
  } | null;
  failedReason: string | null;
}

interface FindDuplicatesButtonProps {
  projectId: string;
}

const STORAGE_KEY_PREFIX = "duplicate-scan-job:";

export function FindDuplicatesButton({ projectId }: FindDuplicatesButtonProps) {
  const t = useTranslations("repository.duplicates");
  const storageKey = `${STORAGE_KEY_PREFIX}${projectId}`;

  const [scanJobId, setScanJobId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return sessionStorage.getItem(storageKey);
  });
  const [scanState, setScanState] = useState<ScanState>(() =>
    typeof window !== "undefined" && sessionStorage.getItem(storageKey)
      ? "active"
      : "idle"
  );

  const { data: pendingCount } = useQuery<number>({
    queryKey: ["duplicate-scan-pending-count", projectId],
    queryFn: async () => {
      const res = await fetch(
        `/api/duplicate-scan/candidates?projectId=${projectId}&limit=10000`
      );
      if (!res.ok) return 0;
      const data = await res.json();
      return data.nextCursor ? data.items.length + 1 : data.items.length;
    },
    enabled: scanState === "idle",
  });

  // Refetch pending count after a scan completes
  const { data: refreshedCount } = useQuery<number>({
    queryKey: ["duplicate-scan-pending-count-refresh", projectId, scanState],
    queryFn: async () => {
      const res = await fetch(
        `/api/duplicate-scan/candidates?projectId=${projectId}&limit=10000`
      );
      if (!res.ok) return 0;
      const data = await res.json();
      return data.items.length;
    },
    enabled: scanState === "complete",
  });

  const badgeCount =
    scanState === "complete" ? (refreshedCount ?? 0) : (pendingCount ?? 0);

  const { data: statusData } = useQuery<StatusData>({
    queryKey: ["duplicate-scan-status", scanJobId],
    queryFn: async () => {
      const r = await fetch(`/api/duplicate-scan/status/${scanJobId}`);
      if (!r.ok) return { state: "unknown" };
      return r.json();
    },
    enabled: !!scanJobId && scanState === "active",
    refetchInterval: 2500,
  });

  useEffect(() => {
    if (!statusData) return;
    if (!statusData.state || statusData.state === "unknown") {
      // Job disappeared (obliterated/expired)
      setScanState("idle");
      sessionStorage.removeItem(storageKey);
      return;
    }
    if (statusData.state === "completed") {
      setScanState("complete");
      sessionStorage.removeItem(storageKey);
      const pairsFound = statusData.result?.pairsFound ?? 0;
      toast.success(t("scanComplete", { count: pairsFound }));
    } else if (statusData.state === "failed") {
      setScanState("failed");
      sessionStorage.removeItem(storageKey);
      toast.error(t("scanFailed"), {
        description: statusData.failedReason ?? t("scanFailedDescription"),
      });
    }
  }, [statusData, storageKey, t]);

  const handleScan = async () => {
    try {
      setScanState("active");
      const res = await fetch("/api/duplicate-scan/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: parseInt(projectId) }),
      });
      const data = await res.json();
      setScanJobId(data.jobId);
      sessionStorage.setItem(storageKey, data.jobId);
    } catch {
      setScanState("failed");
    }
  };

  const progressPercent =
    statusData?.progress && statusData.progress.total > 0
      ? Math.round(
          (statusData.progress.analyzed / statusData.progress.total) * 100
        )
      : 0;

  const analyzed = statusData?.progress?.analyzed ?? 0;
  const total = statusData?.progress?.total ?? 0;

  const isAiPhase = (statusData?.progress as any)?.phase === "ai";

  const handleCancel = async () => {
    if (!scanJobId) return;
    try {
      await fetch(`/api/duplicate-scan/cancel/${scanJobId}`, {
        method: "POST",
      });
    } catch {
      /* ignore */
    }
    sessionStorage.removeItem(storageKey);
    setScanState("idle");
    setScanJobId(null);
  };

  if (scanState === "active") {
    return (
      <div data-testid="scan-progress" className="flex items-center gap-2">
        {isAiPhase ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {t("aiAnalyzing")}
            </span>
          </>
        ) : (
          <>
            <Progress value={progressPercent} className="w-32 h-2" />
            <span className="text-xs text-muted-foreground">
              {t("analyzing", { analyzed, total })}
            </span>
          </>
        )}
        <button
          onClick={handleCancel}
          className="text-muted-foreground hover:text-foreground"
          title={t("cancelScan")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  if (scanState === "complete") {
    const resultsCount = refreshedCount ?? statusData?.result?.pairsFound ?? 0;
    return (
      <div className="relative">
        <Button
          data-testid="view-duplicates-button"
          variant={resultsCount > 0 ? "destructive" : "outline"}
          asChild
          className="group px-4 hover:px-4 transition-all duration-200 gap-0 hover:gap-2"
        >
          <Link href={`/projects/repository/${projectId}/duplicates`}>
            <CopyCheck className="h-4 w-4 shrink-0" />
            <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
              {t("viewResults", { count: resultsCount })}
            </span>
          </Link>
        </Button>
      </div>
    );
  }

  if (scanState === "failed") {
    return (
      <Button
        data-testid="retry-scan-button"
        variant="outline"
        onClick={handleScan}
        className="group px-4 hover:px-4 transition-all duration-200 gap-0 hover:gap-2 text-destructive"
      >
        <CopyCheck className="h-4 w-4 shrink-0" />
        <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
          {t("retryScan")}
        </span>
      </Button>
    );
  }

  // idle — link to results if pending duplicates exist, otherwise scan button
  if (badgeCount > 0) {
    return (
      <Button
        variant="destructive"
        asChild
        className="group px-4 hover:px-4 transition-all duration-200 gap-0 hover:gap-2"
      >
        <Link href={`/projects/repository/${projectId}/duplicates`}>
          <CopyCheck className="h-4 w-4 shrink-0" />
          <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
            {t("viewResults", { count: badgeCount })}
          </span>
        </Link>
      </Button>
    );
  }

  return (
    <Button
      data-testid="find-duplicates-button"
      variant="outline"
      onClick={handleScan}
      className="group px-4 hover:px-4 transition-all duration-200 gap-0 hover:gap-2"
    >
      <CopyCheck className="h-4 w-4 shrink-0" />
      <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
        {t("findDuplicates")}
      </span>
    </Button>
  );
}
