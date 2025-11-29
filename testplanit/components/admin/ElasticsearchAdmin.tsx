"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import {
  RefreshCw,
  Database,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  Activity,
} from "lucide-react";

interface ElasticsearchStatus {
  available: boolean;
  health?: string;
  numberOfNodes?: number;
  indices?: Array<{
    name: string;
    docs: number;
    size: string;
    health: string;
  }>;
  message?: string;
}

interface ReindexProgress {
  progress: number;
  message: string;
  details?: any;
}

interface JobStatus {
  jobId: string;
  state: "waiting" | "active" | "completed" | "failed" | "delayed" | "paused";
  progress: number;
  logs: string[];
  result?: any;
  failedReason?: string;
}

export function ElasticsearchAdmin() {
  const t = useTranslations("admin.elasticsearch");
  const { toast } = useToast();

  const [status, setStatus] = useState<ElasticsearchStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [reindexing, setReindexing] = useState(false);
  const [progress, setProgress] = useState<ReindexProgress | null>(null);
  const [entityType, setEntityType] = useState("all");
  const [numberOfReplicas, setNumberOfReplicas] = useState<number>(0);
  const [savingReplicas, setSavingReplicas] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [jobLogs, setJobLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest logs
  useEffect(() => {
    if (logsEndRef.current && jobLogs.length > 0) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [jobLogs]);

  const checkElasticsearchStatus = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/admin/elasticsearch/reindex");
      const data = await response.json();
      setStatus(data);
    } catch (error) {
      console.error("Failed to check Elasticsearch status:", error);
      setStatus({ available: false, message: "Failed to connect" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkElasticsearchStatus();
    loadReplicaSettings();
  }, [checkElasticsearchStatus]);

  const loadReplicaSettings = async () => {
    try {
      const response = await fetch("/api/admin/elasticsearch/settings");
      if (response.ok) {
        const data = await response.json();
        setNumberOfReplicas(data.numberOfReplicas || 0);
      }
    } catch (error) {
      console.error("Failed to load replica settings:", error);
    }
  };

  const saveReplicaSettings = async () => {
    try {
      setSavingReplicas(true);
      const response = await fetch("/api/admin/elasticsearch/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numberOfReplicas }),
      });

      if (response.ok) {
        toast({
          title: t("settings.saved"),
          description: t("settings.savedDescription"),
        });

        // Update existing indices
        const updateResponse = await fetch(
          "/api/admin/elasticsearch/settings",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ numberOfReplicas }),
          }
        );

        if (updateResponse.ok) {
          toast({
            title: t("settings.updated"),
            description: t("settings.updatedDescription"),
          });
          // Refresh status after updating
          setTimeout(checkElasticsearchStatus, 2000);
        }
      } else {
        throw new Error("Failed to save settings");
      }
    } catch (error) {
      console.error("Failed to save replica settings:", error);
      toast({
        title: t("settings.error"),
        description: t("settings.errorDescription"),
        variant: "destructive",
      });
    } finally {
      setSavingReplicas(false);
    }
  };

  // Poll for job status
  useEffect(() => {
    if (!currentJobId) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(
          `/api/admin/elasticsearch/reindex/${currentJobId}`
        );
        if (!response.ok) {
          throw new Error("Failed to fetch job status");
        }

        const jobStatus: JobStatus = await response.json();

        // Update progress
        const progressValue =
          typeof jobStatus.progress === "number" ? jobStatus.progress : 0;
        const lastLog =
          jobStatus.logs.length > 0
            ? jobStatus.logs[jobStatus.logs.length - 1]
            : "";

        setProgress({
          progress: progressValue,
          message: lastLog || jobStatus.state,
          details: jobStatus.result,
        });

        setJobLogs(jobStatus.logs);

        // Handle completion or failure
        if (jobStatus.state === "completed") {
          clearInterval(pollInterval);
          setReindexing(false);
          setProgress({
            progress: 100,
            message: "Reindex completed!",
            details: jobStatus.result?.results,
          });

          toast({
            title: t("reindex.success.title"),
            description: t("reindex.success.description", {
              count: jobStatus.result?.totalDocuments || 0,
            }),
          });

          // Refresh status after reindex
          setTimeout(() => {
            checkElasticsearchStatus();
            setProgress(null);
            setCurrentJobId(null);
            setJobLogs([]);
          }, 3000);
        } else if (jobStatus.state === "failed") {
          clearInterval(pollInterval);
          setReindexing(false);
          setCurrentJobId(null);

          toast({
            title: t("reindex.error.title"),
            description:
              jobStatus.failedReason || t("reindex.error.description"),
            variant: "destructive",
          });

          setProgress(null);
          setJobLogs([]);
        }
      } catch (error) {
        console.error("Error polling job status:", error);
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(pollInterval);
  }, [currentJobId, t, toast, checkElasticsearchStatus]);

  const startReindex = async () => {
    try {
      setReindexing(true);
      setProgress({ progress: 0, message: "Queueing reindex job..." });
      setJobLogs([]);

      const response = await fetch("/api/admin/elasticsearch/reindex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to queue reindex job");
      }

      const data = await response.json();
      setCurrentJobId(data.jobId);

      setProgress({
        progress: 0,
        message: "Job queued. Waiting for worker...",
      });
    } catch (error: any) {
      console.error("Reindex error:", error);
      toast({
        title: t("reindex.error.title"),
        description: error.message || t("reindex.error.description"),
        variant: "destructive",
      });
      setProgress(null);
      setReindexing(false);
    }
  };

  const getHealthBadge = (health: string) => {
    const variants: Record<
      string,
      "default" | "secondary" | "destructive" | "outline"
    > = {
      green: "default",
      yellow: "secondary",
      red: "destructive",
    };

    return (
      <Badge variant={variants[health] || "outline"}>
        {health.toUpperCase()}
      </Badge>
    );
  };

  const getHealthIcon = (available: boolean, health?: string) => {
    if (!available) return <XCircle className="h-5 w-5 text-destructive" />;
    if (health === "green")
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    if (health === "yellow")
      return <AlertCircle className="h-5 w-5 text-yellow-500" />;
    return <XCircle className="h-5 w-5 text-destructive" />;
  };

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Database className="h-5 w-5" />
              <CardTitle>{t("status.title")}</CardTitle>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={checkElasticsearchStatus}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {t("status.refresh")}
            </Button>
          </div>
          <CardDescription>{t("status.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && !status ? (
            <div className="flex items-center space-x-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t("status.checking")}</span>
            </div>
          ) : status ? (
            <div className="space-y-4">
              <div className="flex items-center space-x-4">
                {getHealthIcon(status.available, status.health)}
                <div>
                  <div className="font-medium">
                    {status.available
                      ? t("status.connected")
                      : t("status.disconnected")}
                  </div>
                  {status.message && (
                    <div className="text-sm text-muted-foreground">
                      {status.message}
                    </div>
                  )}
                </div>
                {status.health && getHealthBadge(status.health)}
              </div>

              {status.numberOfNodes && (
                <div className="text-sm">
                  <span className="text-muted-foreground">
                    {t("status.nodes")}:
                  </span>{" "}
                  {status.numberOfNodes}
                </div>
              )}

              {status.indices && status.indices.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">{t("status.indices")}</h4>
                  <div className="grid gap-2">
                    {status.indices.map((index) => (
                      <div
                        key={index.name}
                        className="flex items-center justify-between rounded-lg border p-2"
                      >
                        <div className="flex items-center space-x-2">
                          <Activity className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm font-mono">
                            {index.name}
                          </span>
                        </div>
                        <div className="flex items-center space-x-4 text-sm">
                          <span className="text-muted-foreground">
                            {index.docs.toLocaleString()}{" "}
                            {t("status.documents")}
                          </span>
                          <span className="text-muted-foreground">
                            {index.size}
                          </span>
                          {getHealthBadge(index.health)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t("status.error.title")}</AlertTitle>
              <AlertDescription>
                {t("status.error.description")}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.title")}</CardTitle>
          <CardDescription>{t("settings.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="replicas">{t("settings.numberOfReplicas")}</Label>
              <div className="flex items-center space-x-4">
                <Input
                  id="replicas"
                  type="number"
                  min="0"
                  max="10"
                  value={numberOfReplicas}
                  onChange={(e) =>
                    setNumberOfReplicas(parseInt(e.target.value) || 0)
                  }
                  className="w-32"
                  disabled={savingReplicas}
                />
                <Button
                  onClick={saveReplicaSettings}
                  disabled={savingReplicas}
                  size="sm"
                >
                  {savingReplicas ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("settings.saving")}
                    </>
                  ) : (
                    t("settings.save")
                  )}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                {t("settings.replicasHelp")}
              </p>
            </div>

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t("settings.note.title")}</AlertTitle>
              <AlertDescription>
                {t("settings.note.description")}
              </AlertDescription>
            </Alert>
          </div>
        </CardContent>
      </Card>

      {/* Reindex Card */}
      <Card>
        <CardHeader>
          <CardTitle>{t("reindex.title")}</CardTitle>
          <CardDescription>{t("reindex.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-4">
            <Select
              value={entityType}
              onValueChange={setEntityType}
              disabled={reindexing}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("reindex.entities.all")}</SelectItem>
                <SelectItem value="repositoryCases">
                  {t("reindex.entities.repositoryCases")}
                </SelectItem>
                <SelectItem value="testRuns">
                  {t("reindex.entities.testRuns")}
                </SelectItem>
                <SelectItem value="sessions">
                  {t("reindex.entities.sessions")}
                </SelectItem>
                <SelectItem value="sharedSteps">
                  {t("reindex.entities.sharedSteps")}
                </SelectItem>
                <SelectItem value="issues">
                  {t("reindex.entities.issues")}
                </SelectItem>
                <SelectItem value="milestones">
                  {t("reindex.entities.milestones")}
                </SelectItem>
                <SelectItem value="projects">
                  {t("reindex.entities.projects")}
                </SelectItem>
              </SelectContent>
            </Select>

            <Button
              onClick={startReindex}
              disabled={reindexing || !status?.available}
              className="min-w-[120px]"
            >
              {reindexing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("reindex.button.indexing")}
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  {t("reindex.button.start")}
                </>
              )}
            </Button>
          </div>

          {progress && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {progress.message}
                </span>
                <span className="font-medium">
                  {Math.round(progress.progress)}
                  {"%"}
                </span>
              </div>
              <Progress value={progress.progress} className="w-full" />

              {jobLogs.length > 0 && progress.progress < 100 && (
                <div className="rounded-md border bg-muted/50 p-3 max-h-64 overflow-y-auto">
                  <div className="space-y-1">
                    {jobLogs.slice(-10).map((log, index) => (
                      <div
                        key={index}
                        className="text-xs font-mono text-muted-foreground"
                      >
                        {log}
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                </div>
              )}

              {progress.details && progress.progress === 100 && (
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertTitle>{t("reindex.complete.title")}</AlertTitle>
                  <AlertDescription>
                    <div className="mt-2 space-y-1">
                      {Object.entries(progress.details).map(([key, value]) => (
                        <div key={key} className="text-sm">
                          <span className="font-medium">{key}:</span>{" "}
                          <span>{(value as number).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t("reindex.warning.title")}</AlertTitle>
            <AlertDescription>
              {t("reindex.warning.description")}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
