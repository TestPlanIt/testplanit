"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Eye, Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { ReportChart } from "@/components/dataVisualizations/ReportChart";
import { DataTable } from "@/components/tables/DataTable";
import { useTranslations } from "next-intl";

interface StaticReportViewerProps {
  shareData: any;
  shareMode: string;
}

export function StaticReportViewer({ shareData, shareMode }: StaticReportViewerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [reportData, setReportData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("reports");

  useEffect(() => {
    fetchReportData();
  }, []);

  const fetchReportData = async () => {
    if (shareData.entityType !== "REPORT") {
      setError("Only report sharing is currently implemented");
      setIsLoading(false);
      return;
    }

    try {
      const config = shareData.entityConfig;
      if (!config) {
        throw new Error("Invalid report configuration");
      }

      // Get the verified token from sessionStorage (for password-protected shares)
      const shareKey = window.location.pathname.split("/share/")[1];
      const tokenKey = `share_token_${shareKey}`;
      const stored = sessionStorage.getItem(tokenKey);
      let token = null;

      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          token = parsed.token;
        } catch (e) {
          // Invalid token, ignore
        }
      }

      // Call the share report API to fetch data
      const url = new URL(`/api/share/${shareKey}/report`, window.location.origin);
      if (token) {
        url.searchParams.set("token", token);
      }

      const response = await fetch(url.toString());

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to load report data");
      }

      const data = await response.json();
      setReportData(data);
    } catch (error) {
      console.error("Error fetching report data:", error);
      setError(error instanceof Error ? error.message : "Failed to load report data");
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">{"Loading report..."}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!reportData) {
    return null;
  }

  const config = shareData.entityConfig;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="h-5 w-5 text-muted-foreground" />
                <Badge variant="outline">{shareData.entityType}</Badge>
                <Badge variant="secondary">
                  <Eye className="h-3 w-3 mr-1" />
                  {shareData.viewCount} {shareData.viewCount !== 1 ? "views" : "view"}
                </Badge>
              </div>
              <h1 className="text-2xl font-bold mb-1">
                {shareData.title || "Shared Report"}
              </h1>
              {shareData.description && (
                <p className="text-sm text-muted-foreground">{shareData.description}</p>
              )}
            </div>
          </div>

          {/* Project info */}
          {shareData.projectName && (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <span>{"From project:"}</span>
              <span className="font-medium">{shareData.projectName}</span>
            </div>
          )}

          {/* Report config info */}
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            {config.startDate && config.endDate && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{"Date range:"}</span>
                <span className="font-medium">
                  {new Date(config.startDate).toLocaleDateString()} -{" "}
                  {new Date(config.endDate).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Report content */}
      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Visualization */}
        {reportData.chartData && config.dimensions && config.metrics && (
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">{"Visualization"}</h2>
            <ReportChart
              data={reportData.chartData}
              dimensions={config.dimensions}
              metrics={config.metrics}
              reportType={config.reportType}
            />
          </Card>
        )}

        {/* Data Table */}
        {reportData.results && reportData.columns && (
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">{"Results"}</h2>
            <DataTable
              data={reportData.results}
              columns={reportData.columns}
              pagination={reportData.pagination}
            />
          </Card>
        )}

        {/* Read-only notice */}
        <div className="text-center text-sm text-muted-foreground py-4">
          <p>{"This is a read-only shared view"}</p>
        </div>
      </div>
    </div>
  );
}
