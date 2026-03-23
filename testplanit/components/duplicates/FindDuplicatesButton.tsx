"use client";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useQuery } from "@tanstack/react-query";
import { ScanSearch } from "lucide-react";
import { Link } from "~/lib/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type ScanState = "idle" | "active" | "complete" | "failed";

interface StatusData {
  jobId: string;
  state: string;
  progress: { analyzed: number; total: number } | null;
  result: { pairsFound: number; casesScanned: number; scanJobId: number } | null;
  failedReason: string | null;
}

interface FindDuplicatesButtonProps {
  projectId: string;
}

const STORAGE_KEY_PREFIX = "duplicate-scan-job:";

export function FindDuplicatesButton({ projectId }: FindDuplicatesButtonProps) {
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
        `/api/duplicate-scan/candidates?projectId=${projectId}&limit=1`
      );
      if (!res.ok) return 0;
      const data = await res.json();
      return data.items.length + (data.nextCursor ? 1 : 0);
    },
    enabled: scanState === "idle",
  });

  // Refetch pending count after a scan completes
  const { data: refreshedCount } = useQuery<number>({
    queryKey: ["duplicate-scan-pending-count-refresh", projectId, scanState],
    queryFn: async () => {
      const res = await fetch(
        `/api/duplicate-scan/candidates?projectId=${projectId}&limit=100`
      );
      if (!res.ok) return 0;
      const data = await res.json();
      return data.items.length;
    },
    enabled: scanState === "complete",
  });

  const badgeCount = scanState === "complete" ? (refreshedCount ?? 0) : (pendingCount ?? 0);

  const { data: statusData } = useQuery<StatusData>({
    queryKey: ["duplicate-scan-status", scanJobId],
    queryFn: () =>
      fetch(`/api/duplicate-scan/status/${scanJobId}`).then((r) => r.json()),
    enabled: !!scanJobId && scanState === "active",
    refetchInterval: 2500,
  });

  useEffect(() => {
    if (!statusData) return;
    if (statusData.state === "completed") {
      setScanState("complete");
      sessionStorage.removeItem(storageKey);
      const pairsFound = statusData.result?.pairsFound ?? 0;
      if (pairsFound > 0) {
        toast.success(`Duplicate analysis complete — ${pairsFound} potential duplicate${pairsFound === 1 ? "" : "s"} found`);
      } else {
        toast.success("Duplicate analysis complete — no duplicates found");
      }
    } else if (statusData.state === "failed") {
      setScanState("failed");
      sessionStorage.removeItem(storageKey);
      toast.error("Duplicate analysis failed", {
        description: statusData.failedReason ?? "An unexpected error occurred",
      });
    }
  }, [statusData, storageKey]);

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

  if (scanState === "active") {
    return (
      <div className="flex items-center gap-2">
        <Progress value={progressPercent} className="w-32 h-2" />
        <span className="text-xs text-muted-foreground">
          {analyzed}/{total}
        </span>
      </div>
    );
  }

  if (scanState === "complete") {
    const resultsCount = refreshedCount ?? statusData?.result?.pairsFound ?? 0;
    return (
      <div className="relative">
        <Button variant="outline" asChild className="group px-4 hover:px-4 transition-all duration-200 gap-0 hover:gap-2">
          <Link href={`/projects/repository/${projectId}/duplicates`}>
            <ScanSearch className="h-4 w-4 shrink-0" />
            <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
              View Results
            </span>
          </Link>
        </Button>
        {resultsCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
            {resultsCount > 99 ? "99+" : resultsCount}
          </span>
        )}
      </div>
    );
  }

  if (scanState === "failed") {
    return (
      <Button
        variant="outline"
        onClick={handleScan}
        className="group px-4 hover:px-4 transition-all duration-200 gap-0 hover:gap-2 text-destructive"
      >
        <ScanSearch className="h-4 w-4 shrink-0" />
        <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
          Retry Scan
        </span>
      </Button>
    );
  }

  // idle
  return (
    <div className="relative">
      <Button
        variant="outline"
        onClick={handleScan}
        className="group px-4 hover:px-4 transition-all duration-200 gap-0 hover:gap-2"
      >
        <ScanSearch className="h-4 w-4 shrink-0" />
        <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
          Find Duplicates
        </span>
      </Button>
      {badgeCount > 0 && (
        <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      )}
    </div>
  );
}
