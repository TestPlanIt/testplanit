"use client";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useQuery } from "@tanstack/react-query";
import { GitCompare, X } from "lucide-react";
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
    matchesFound: number;
    casesScanned: number;
  } | null;
  failedReason: string | null;
}

interface FindStepDuplicatesButtonProps {
  projectId: string;
}

const STORAGE_KEY_PREFIX = "step-scan-job:";

export function FindStepDuplicatesButton({
  projectId,
}: FindStepDuplicatesButtonProps) {
  const t = useTranslations("sharedSteps.stepDuplicates");
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

  const { data: statusData } = useQuery<StatusData>({
    queryKey: ["step-scan-status", scanJobId],
    queryFn: async () => {
      const r = await fetch(`/api/step-scan/status/${scanJobId}`);
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
      const matchesFound = statusData.result?.matchesFound ?? 0;
      toast.success(t("scanComplete", { count: matchesFound }));
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
      const res = await fetch("/api/step-scan/submit", {
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

  const handleCancel = async () => {
    if (!scanJobId) return;
    try {
      await fetch(`/api/step-scan/cancel/${scanJobId}`, {
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
      <div data-testid="step-scan-progress" className="flex items-center gap-2">
        <Progress value={progressPercent} className="w-32 h-2" />
        <span className="text-xs text-muted-foreground">
          {`${progressPercent}%`}
        </span>
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
    const resultsCount = statusData?.result?.matchesFound ?? 0;
    return (
      <div className="relative">
        <Button
          data-testid="view-step-duplicates-button"
          variant={resultsCount > 0 ? "destructive" : "outline"}
          asChild
          className="group px-4 hover:px-4 transition-all duration-200 gap-0 hover:gap-2"
        >
          <Link href={`/projects/shared-steps/${projectId}/step-duplicates`}>
            <GitCompare className="h-4 w-4 shrink-0" />
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
        data-testid="retry-step-scan-button"
        variant="outline"
        onClick={handleScan}
        className="group px-4 hover:px-4 transition-all duration-200 gap-0 hover:gap-2 text-destructive"
      >
        <GitCompare className="h-4 w-4 shrink-0" />
        <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
          {t("retryScan")}
        </span>
      </Button>
    );
  }

  // idle — link to results or scan button
  return (
    <Button
      data-testid="find-step-duplicates-button"
      variant="outline"
      onClick={handleScan}
      className="group px-4 hover:px-4 transition-all duration-200 gap-0 hover:gap-2"
    >
      <GitCompare className="h-4 w-4 shrink-0" />
      <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
        {t("findStepDuplicates")}
      </span>
    </Button>
  );
}
