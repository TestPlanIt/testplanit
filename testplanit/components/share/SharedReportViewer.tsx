"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, BarChart3, Eye } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface SharedReportViewerProps {
  shareData: any;
  shareMode: string;
}

export function SharedReportViewer({ shareData, shareMode }: SharedReportViewerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [reportData, setReportData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Fetch the actual report data
    fetchReportData();
  }, []);

  const fetchReportData = async () => {
    if (shareData.entityType !== "REPORT") {
      setError("Only report sharing is currently implemented");
      setIsLoading(false);
      return;
    }

    try {
      // For now, we'll display the share metadata
      // TODO: Implement actual report data fetching from /api/report-builder/shared
      setReportData(shareData);
      setIsLoading(false);
    } catch (error) {
      console.error("Error fetching report data:", error);
      setError("Failed to load report data");
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Loading report...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Alert variant="destructive" className="max-w-md">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
              <Badge variant="outline">{shareData.entityType}</Badge>
              <Badge variant="secondary">
                <Eye className="h-3 w-3 mr-1" />
                {shareData.viewCount} view{shareData.viewCount !== 1 ? "s" : ""}
              </Badge>
            </div>
            <h1 className="text-3xl font-bold mb-2">
              {shareData.title || "Shared Report"}
            </h1>
            {shareData.description && (
              <p className="text-muted-foreground">{shareData.description}</p>
            )}
          </div>
        </div>

        {/* Project info */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>From project:</span>
          <span className="font-medium">{shareData.projectName}</span>
        </div>
      </div>

      {/* Report content */}
      <Card>
        <CardHeader>
          <CardTitle>Report Data</CardTitle>
          <CardDescription>
            This is a shared report view. Full report functionality will be implemented in the
            next phase.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium mb-2">Report Configuration</h3>
              <pre className="bg-muted p-4 rounded-lg text-sm overflow-auto">
                {JSON.stringify(shareData.entityConfig, null, 2)}
              </pre>
            </div>

            <Alert>
              <AlertDescription>
                <strong>Note:</strong> The full ReportBuilder component integration is the next
                step. This placeholder shows the report configuration that would be used to
                fetch and display the actual report data.
              </AlertDescription>
            </Alert>
          </div>
        </CardContent>
      </Card>

      {/* Footer info */}
      <div className="mt-8 text-center text-sm text-muted-foreground">
        <p>This is a read-only shared view</p>
      </div>
    </div>
  );
}
