"use client";

import { Button } from "@/components/ui/button";
import { DuplicateResultsTable } from "@/components/duplicates/DuplicateResultsTable";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "~/lib/navigation";

export default function DuplicatesPage() {
  const t = useTranslations("repository.duplicates");
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [isScanning, setIsScanning] = useState(false);

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

      // Poll for completion
      const poll = async () => {
        const statusRes = await fetch(`/api/duplicate-scan/status/${jobId}`);
        const status = await statusRes.json();
        if (status.state === "completed") {
          toast.success(t("scanComplete", { count: status.result?.pairsFound ?? 0 }));
          queryClient.invalidateQueries({ queryKey: ["duplicate-scan-candidates", projectId] });
          setIsScanning(false);
        } else if (status.state === "failed") {
          toast.error(t("scanFailed"), { description: status.failedReason });
          setIsScanning(false);
        } else {
          setTimeout(poll, 2500);
        }
      };
      poll();
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
          <h1 className="text-2xl font-bold">{t("pageTitle")}</h1>
          <p className="text-muted-foreground">{t("pageDescription")}</p>
        </div>
        <Button
          variant="outline"
          onClick={handleRescan}
          disabled={isScanning}
        >
          {isScanning ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {t("rescan")}
        </Button>
      </div>
      <DuplicateResultsTable projectId={projectId} />
    </div>
  );
}
