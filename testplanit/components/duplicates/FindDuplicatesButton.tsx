"use client";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useQuery } from "@tanstack/react-query";
import { ScanSearch } from "lucide-react";
import { Link } from "~/lib/navigation";
import { useEffect, useState } from "react";

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

export function FindDuplicatesButton({ projectId }: FindDuplicatesButtonProps) {
  const [scanJobId, setScanJobId] = useState<string | null>(null);
  const [scanState, setScanState] = useState<ScanState>("idle");

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
    } else if (statusData.state === "failed") {
      setScanState("failed");
    }
  }, [statusData]);

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
    return (
      <Button variant="outline" size="sm" asChild>
        <Link href={`/projects/repository/${projectId}/duplicates`}>
          View Results ({statusData?.result?.pairsFound ?? 0})
        </Link>
      </Button>
    );
  }

  if (scanState === "failed") {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={handleScan}
        className="text-destructive"
      >
        Retry Scan
      </Button>
    );
  }

  // idle
  return (
    <Button variant="outline" size="sm" onClick={handleScan}>
      <ScanSearch className="h-4 w-4 mr-1" />
      Find Duplicates
    </Button>
  );
}
