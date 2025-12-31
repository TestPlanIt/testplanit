"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import {
  RefreshCw,
  Loader2,
  X,
  Trash2,
  RotateCcw,
  ChevronUp,
  Eye,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Job {
  id: string;
  name: string;
  data: any;
  opts: any;
  progress: number;
  returnvalue: any;
  stacktrace: string[];
  timestamp: number;
  attemptsMade: number;
  failedReason?: string;
  finishedOn?: number;
  processedOn?: number;
  state: string;
}

interface QueueJobsViewProps {
  queueName: string;
  onClose: () => void;
  onRefresh: () => void;
}

export function QueueJobsView({
  queueName,
  onClose,
  onRefresh,
}: QueueJobsViewProps) {
  const t = useTranslations("admin.queues.jobs");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common.actions");
  const { toast } = useToast();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState("all");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [forceRemoveDialog, setForceRemoveDialog] = useState<{
    show: boolean;
    jobId: string | null;
    action: string | null;
    errorMessage: string | null;
  }>({ show: false, jobId: null, action: null, errorMessage: null });

  const loadJobs = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/admin/queues/${queueName}/jobs?state=${state}&start=0&end=100`
      );
      if (!response.ok) {
        throw new Error("Failed to load jobs");
      }
      const data = await response.json();
      setJobs(data.jobs);
    } catch (error: any) {
      console.error("Error loading jobs:", error);
      toast({
        title: t("error.loadFailed"),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [queueName, state, toast, t]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const performJobAction = async (
    jobId: string,
    action: string,
    force: boolean = false
  ) => {
    try {
      setActionInProgress(jobId);

      // Build URL with force parameter for DELETE requests
      const url =
        action === "remove" && force
          ? `/api/admin/queues/${queueName}/jobs/${jobId}?force=true`
          : `/api/admin/queues/${queueName}/jobs/${jobId}`;

      const response = await fetch(url, {
        method: action === "remove" ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body:
          action !== "remove" ? JSON.stringify({ action, force }) : undefined,
      });

      if (!response.ok) {
        const error = await response.json();

        // Check if this is an active/locked job error
        if (
          (error.error?.includes("Cannot remove active") ||
            error.error?.includes("locked by a worker")) &&
          !force
        ) {
          // Ask user if they want to force remove
          setForceRemoveDialog({
            show: true,
            jobId,
            action,
            errorMessage: error.error,
          });
          return; // Exit early, dialog will handle the retry
        }

        throw new Error(error.error || "Action failed");
      }

      const result = await response.json();

      // Show appropriate message for partial success vs full success
      if (result.partialSuccess) {
        toast({
          title: "Partial Success",
          description: result.message,
          variant: "default", // Could use a warning variant if available
        });
      } else {
        toast({
          title: t("success.actionCompleted"),
          description: result.message,
        });
      }

      // Reload jobs and parent queue stats
      await loadJobs();
      onRefresh();
    } catch (error: any) {
      console.error("Error performing action:", error);
      toast({
        title: t("error.actionFailed"),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setActionInProgress(null);
    }
  };

  const getStateBadge = (state: string) => {
    const variants: Record<string, { variant: any; icon: React.ReactNode }> = {
      waiting: {
        variant: "secondary",
        icon: <Clock className="h-3 w-3" />,
      },
      active: {
        variant: "default",
        icon: <Loader2 className="h-3 w-3 animate-spin" />,
      },
      completed: {
        variant: "outline",
        icon: <CheckCircle2 className="h-3 w-3 text-green-500" />,
      },
      failed: {
        variant: "destructive",
        icon: <XCircle className="h-3 w-3" />,
      },
      delayed: {
        variant: "secondary",
        icon: <AlertCircle className="h-3 w-3" />,
      },
    };

    const config = variants[state] || variants.waiting;

    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        {config.icon}
        {state}
      </Badge>
    );
  };

  const formatTimestamp = (timestamp?: number) => {
    if (!timestamp) return "-";
    return new Date(timestamp).toLocaleString();
  };

  const formatDuration = (start?: number, end?: number) => {
    if (!start || !end) return "-";
    const duration = end - start;
    const seconds = Math.floor(duration / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>
                {t("title")} - {queueName}
              </CardTitle>
              <CardDescription>{t("description")}</CardDescription>
            </div>
            <div className="flex gap-2">
              <Select value={state} onValueChange={setState}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {tGlobal("repository.views.allStates")}
                  </SelectItem>
                  <SelectItem value="waiting">
                    {tGlobal("admin.queues.table.waiting")}
                  </SelectItem>
                  <SelectItem value="active">
                    {tGlobal("common.fields.isActive")}
                  </SelectItem>
                  <SelectItem value="completed">
                    {tGlobal("common.fields.completed")}
                  </SelectItem>
                  <SelectItem value="failed">
                    {tGlobal("admin.queues.table.failed")}
                  </SelectItem>
                  <SelectItem value="delayed">
                    {tGlobal("milestones.statusLabels.delayed")}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={loadJobs}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
              <Button variant="outline" size="sm" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t("noJobs")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("table.id")}</TableHead>
                  <TableHead>{t("table.name")}</TableHead>
                  <TableHead>{tGlobal("common.fields.state")}</TableHead>
                  <TableHead>{t("table.attempts")}</TableHead>
                  <TableHead>{tGlobal("common.fields.created")}</TableHead>
                  <TableHead>{tGlobal("common.fields.duration")}</TableHead>
                  <TableHead className="text-right">
                    {tGlobal("common.actions.actionsLabel")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-mono text-sm">
                      {job.id?.substring(0, 8)}
                      {"..."}
                    </TableCell>
                    <TableCell>{job.name}</TableCell>
                    <TableCell>{getStateBadge(job.state)}</TableCell>
                    <TableCell>
                      {job.attemptsMade}/{job.opts?.attempts || 1}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatTimestamp(job.timestamp)}
                    </TableCell>
                    <TableCell>
                      {formatDuration(job.processedOn, job.finishedOn)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          className="px-2 py-1 h-auto"
                          onClick={() => setSelectedJob(job)}
                          disabled={actionInProgress === job.id}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {job.state === "failed" && (
                          <Button
                            variant="ghost"
                            className="px-2 py-1 h-auto"
                            onClick={() => performJobAction(job.id, "retry")}
                            disabled={actionInProgress === job.id}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        )}
                        {job.state === "delayed" && (
                          <Button
                            variant="ghost"
                            className="px-2 py-1 h-auto"
                            onClick={() => performJobAction(job.id, "promote")}
                            disabled={actionInProgress === job.id}
                          >
                            <ChevronUp className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="destructive"
                          className="px-2 py-1 h-auto"
                          onClick={() => performJobAction(job.id, "remove")}
                          disabled={actionInProgress === job.id}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Job Details Dialog */}
      {selectedJob && (
        <Dialog open={!!selectedJob} onOpenChange={() => setSelectedJob(null)}>
          <DialogContent className="max-w-3xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle>
                {t("details.title")} - {selectedJob.name}
              </DialogTitle>
              <DialogDescription>
                {"ID: "}
                {selectedJob.id}
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-semibold mb-2">
                    {tGlobal("common.fields.state")}
                  </h4>
                  {getStateBadge(selectedJob.state)}
                </div>

                {selectedJob.failedReason && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2 text-destructive">
                      {t("details.failedReason")}
                    </h4>
                    <pre className="bg-muted p-3 rounded text-sm overflow-x-auto">
                      {selectedJob.failedReason}
                    </pre>
                  </div>
                )}

                {selectedJob.stacktrace &&
                  selectedJob.stacktrace.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2 text-destructive">
                        {t("details.stacktrace")}
                      </h4>
                      <pre className="bg-muted p-3 rounded text-sm overflow-x-auto">
                        {selectedJob.stacktrace.join("\n")}
                      </pre>
                    </div>
                  )}

                <div>
                  <h4 className="text-sm font-semibold mb-2">
                    {t("details.data")}
                  </h4>
                  <pre className="bg-muted p-3 rounded text-sm overflow-x-auto">
                    {JSON.stringify(selectedJob.data, null, 2)}
                  </pre>
                </div>

                {selectedJob.returnvalue && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2">
                      {t("details.returnValue")}
                    </h4>
                    <pre className="bg-muted p-3 rounded text-sm overflow-x-auto">
                      {JSON.stringify(selectedJob.returnvalue, null, 2)}
                    </pre>
                  </div>
                )}

                <div>
                  <h4 className="text-sm font-semibold mb-2">
                    {t("details.options")}
                  </h4>
                  <pre className="bg-muted p-3 rounded text-sm overflow-x-auto">
                    {JSON.stringify(selectedJob.opts, null, 2)}
                  </pre>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-semibold">
                      {tGlobal("common.fields.created")}:
                    </span>{" "}
                    {formatTimestamp(selectedJob.timestamp)}
                  </div>
                  <div>
                    <span className="font-semibold">
                      {t("details.processed")}:
                    </span>{" "}
                    {formatTimestamp(selectedJob.processedOn)}
                  </div>
                  <div>
                    <span className="font-semibold">
                      {t("details.finished")}:
                    </span>{" "}
                    {formatTimestamp(selectedJob.finishedOn)}
                  </div>
                  <div>
                    <span className="font-semibold">
                      {tGlobal("common.fields.duration")}:
                    </span>{" "}
                    {formatDuration(
                      selectedJob.processedOn,
                      selectedJob.finishedOn
                    )}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      )}

      {/* Force Remove Confirmation Dialog */}
      <Dialog
        open={forceRemoveDialog.show}
        onOpenChange={(open) => {
          if (!open) {
            setForceRemoveDialog({
              show: false,
              jobId: null,
              action: null,
              errorMessage: null,
            });
            setActionInProgress(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("forceRemove.title")}</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-4">
                <p>{forceRemoveDialog.errorMessage}</p>
                <p className="font-semibold">{t("forceRemove.question")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("forceRemove.warning")}
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              onClick={() => {
                setForceRemoveDialog({
                  show: false,
                  jobId: null,
                  action: null,
                  errorMessage: null,
                });
                setActionInProgress(null);
              }}
            >
              {tGlobal("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                setForceRemoveDialog({
                  show: false,
                  jobId: null,
                  action: null,
                  errorMessage: null,
                });
                if (forceRemoveDialog.jobId && forceRemoveDialog.action) {
                  await performJobAction(
                    forceRemoveDialog.jobId,
                    forceRemoveDialog.action,
                    true
                  );
                }
              }}
            >
              {t("forceRemove.confirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
