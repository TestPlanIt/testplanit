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
  Pause,
  Play,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
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
  DialogFooter,
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { QueueJobsView } from "./QueueJobsView";

interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

interface QueueInfo {
  name: string;
  counts: QueueCounts | null;
  isPaused: boolean;
  error: string | null;
  concurrency: number;
}

export function QueueManagement() {
  const t = useTranslations("admin.queues");
  const { toast } = useToast();

  const [queues, setQueues] = useState<QueueInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedQueue, setSelectedQueue] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    queueName: string;
    action: string;
    title: string;
    description: string;
  } | null>(null);

  const loadQueues = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/admin/queues");
      if (!response.ok) {
        throw new Error("Failed to load queues");
      }
      const data = await response.json();
      setQueues(data.queues);
    } catch (error: any) {
      console.error("Error loading queues:", error);
      toast({
        title: t("error.loadFailed"),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    loadQueues();
    // Auto-refresh every 10 seconds
    const interval = setInterval(loadQueues, 10000);
    return () => clearInterval(interval);
  }, [loadQueues]);

  const performQueueAction = async (
    queueName: string,
    action: string,
    confirmationRequired: boolean = false
  ) => {
    if (confirmationRequired && !confirmDialog) {
      // Show confirmation dialog
      const confirmTitles: Record<string, string> = {
        clean: t("actions.clean.confirmTitle"),
        drain: t("actions.drain.confirmTitle"),
        obliterate: t("actions.obliterate.confirmTitle"),
      };
      const confirmDescriptions: Record<string, string> = {
        clean: t("actions.clean.confirmDescription"),
        drain: t("actions.drain.confirmDescription"),
        obliterate: t("actions.obliterate.confirmDescription"),
      };

      setConfirmDialog({
        open: true,
        queueName,
        action,
        title: confirmTitles[action] || "",
        description: confirmDescriptions[action] || "",
      });
      return;
    }

    try {
      setActionInProgress(queueName);
      const response = await fetch(`/api/admin/queues/${queueName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Action failed");
      }

      const result = await response.json();
      toast({
        title: t("success.actionCompleted"),
        description: result.message,
      });

      // Reload queues
      await loadQueues();
    } catch (error: any) {
      console.error("Error performing action:", error);
      toast({
        title: t("error.actionFailed"),
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setActionInProgress(null);
      setConfirmDialog(null);
    }
  };

  const getQueueDisplayName = (name: string) => {
    const queueNames: Record<string, string> = {
      "forecast-updates": t("queueNames.forecast-updates"),
      "notifications": t("queueNames.notifications"),
      "emails": t("queueNames.emails"),
      "issue-sync": t("queueNames.issue-sync"),
      "testmo-imports": t("queueNames.testmo-imports"),
      "elasticsearch-reindex": t("queueNames.elasticsearch-reindex"),
    };
    return queueNames[name] || name;
  };

  const getTotalJobs = (counts: QueueCounts | null) => {
    if (!counts) return 0;
    return counts.waiting + counts.active + counts.delayed;
  };

  const getStatusBadge = (queue: QueueInfo) => {
    if (queue.error) {
      return (
        <Badge variant="destructive" className="flex items-center gap-1">
          <XCircle className="h-3 w-3" />
          {t("status.error")}
        </Badge>
      );
    }

    if (queue.isPaused) {
      return (
        <Badge variant="secondary" className="flex items-center gap-1">
          <Pause className="h-3 w-3" />
          {t("status.paused")}
        </Badge>
      );
    }

    if (queue.counts && queue.counts.active > 0) {
      return (
        <Badge variant="default" className="flex items-center gap-1">
          <Activity className="h-3 w-3 animate-pulse" />
          {t("status.active")}
        </Badge>
      );
    }

    return (
      <Badge variant="outline" className="flex items-center gap-1">
        <CheckCircle2 className="h-3 w-3" />
        {t("status.idle")}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* Concurrency Info Alert */}
      <Alert>
        <Activity className="h-4 w-4" />
        <AlertTitle>{t("concurrency.title")}</AlertTitle>
        <AlertDescription>
          <p className="mb-2">{t("concurrency.description")}</p>
          <p className="text-sm font-medium">{t("concurrency.configureTitle")}</p>
          <p className="text-sm text-muted-foreground">{t("concurrency.configureDescription")}</p>
        </AlertDescription>
      </Alert>

      {/* Overview Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t("title")}</CardTitle>
              <CardDescription>{t("description")}</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={loadQueues}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="ml-2">{t("refresh")}</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("table.queue")}</TableHead>
                <TableHead>{t("table.status")}</TableHead>
                <TableHead className="text-right">{t("table.concurrency")}</TableHead>
                <TableHead className="text-right">{t("table.waiting")}</TableHead>
                <TableHead className="text-right">{t("table.active")}</TableHead>
                <TableHead className="text-right">{t("table.completed")}</TableHead>
                <TableHead className="text-right">{t("table.failed")}</TableHead>
                <TableHead className="text-right">{t("table.delayed")}</TableHead>
                <TableHead className="text-right">{t("table.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queues.map((queue) => (
                <TableRow
                  key={queue.name}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelectedQueue(queue.name)}
                >
                  <TableCell className="font-medium">
                    {getQueueDisplayName(queue.name)}
                  </TableCell>
                  <TableCell>{getStatusBadge(queue)}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary" className="font-mono">
                      {queue.concurrency}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {queue.counts?.waiting ?? "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    {queue.counts?.active ?? "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    {queue.counts?.completed ?? "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {queue.counts && queue.counts.failed > 0 && (
                        <AlertTriangle className="h-3 w-3 text-destructive" />
                      )}
                      {queue.counts?.failed ?? "-"}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {queue.counts?.delayed ?? "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                      {queue.isPaused ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => performQueueAction(queue.name, "resume")}
                          disabled={actionInProgress === queue.name}
                        >
                          <Play className="h-3 w-3" />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => performQueueAction(queue.name, "pause")}
                          disabled={actionInProgress === queue.name}
                        >
                          <Pause className="h-3 w-3" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => performQueueAction(queue.name, "clean", true)}
                        disabled={actionInProgress === queue.name}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Jobs View */}
      {selectedQueue && (
        <QueueJobsView
          queueName={selectedQueue}
          onClose={() => setSelectedQueue(null)}
          onRefresh={loadQueues}
        />
      )}

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <Dialog
          open={confirmDialog.open}
          onOpenChange={(open) => !open && setConfirmDialog(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{confirmDialog.title}</DialogTitle>
              <DialogDescription>{confirmDialog.description}</DialogDescription>
            </DialogHeader>
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{t("actions.warning")}</AlertTitle>
              <AlertDescription>
                {t("actions.irreversible")}
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirmDialog(null)}
              >
                {t("actions.cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={() =>
                  performQueueAction(confirmDialog.queueName, confirmDialog.action)
                }
              >
                {t("actions.confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
