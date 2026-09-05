"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/typography";
import { HelpPopover } from "@/components/ui/help-popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DataTable } from "@/components/tables/DataTable";
import { ColumnDef } from "@tanstack/react-table";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Trash,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
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

// DataTable rows need an `id`; the queue name is the natural key.
type QueueRow = QueueInfo & { id: string };

export function QueueManagement() {
  const t = useTranslations("admin.queues");
  const tGlobal = useTranslations();

  const [queues, setQueues] = useState<QueueInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedQueue, setSelectedQueue] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});
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
      toast.error(t("error.loadFailed"), {
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadQueues();
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
      toast.success(t("success.actionCompleted"), {
        description: result.message,
      });

      // Reload queues
      await loadQueues();
    } catch (error: any) {
      console.error("Error performing action:", error);
      toast.error(t("error.actionFailed"), {
        description: error.message,
      });
    } finally {
      setActionInProgress(null);
      setConfirmDialog(null);
    }
  };

  const getQueueDisplayName = (name: string) => {
    const queueNames: Record<string, string> = {
      "forecast-updates": t("queueNames.forecast-updates"),
      notifications: tGlobal("common.fields.notificationMode"),
      emails: t("queueNames.emails"),
      "issue-sync": t("queueNames.issue-sync"),
      "testmo-imports": t("queueNames.testmo-imports"),
      "elasticsearch-reindex": t("queueNames.elasticsearch-reindex"),
      "audit-logs": t("queueNames.audit-logs"),
      "budget-alerts": t("queueNames.budget-alerts"),
      "auto-tag": t("queueNames.auto-tag"),
      "repo-cache": t("queueNames.repo-cache"),
      "copy-move": t("queueNames.copy-move"),
      "duplicate-scan": t("queueNames.duplicate-scan"),
      "magic-select": t("queueNames.magic-select"),
      "step-scan": t("queueNames.step-scan"),
    };
    // Queues without a curated localized label (e.g. ones added after this
    // map) fall back to a humanized version of their name — "webhook-dispatch"
    // -> "Webhook Dispatch" — so the dynamically-listed queues still read
    // cleanly instead of showing a raw kebab-case key.
    return (
      queueNames[name] ||
      name
        .split(/[-_]/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
    );
  };

  const _getTotalJobs = (counts: QueueCounts | null) => {
    if (!counts) return 0;
    return counts.waiting + counts.active + counts.delayed;
  };

  const getStatusBadge = (queue: QueueInfo) => {
    if (queue.error) {
      return (
        <Badge
          variant="destructive"
          className="flex items-center gap-1"
          title={queue.error}
        >
          <XCircle className="h-3 w-3" />
          {tGlobal("common.errors.error")}
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
          {tGlobal("common.fields.isActive")}
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

  const queueRows: QueueRow[] = queues.map((queue) => ({
    ...queue,
    id: queue.name,
  }));

  const queueColumns: ColumnDef<QueueRow>[] = [
    {
      id: "queue",
      accessorKey: "name",
      header: t("table.queue"),
      enableSorting: false,
      enableResizing: true,
      enableHiding: false,
      meta: { isPinned: "left" },
      size: 220,
      cell: ({ row }) => (
        <div className="font-medium">
          {getQueueDisplayName(row.original.name)}
        </div>
      ),
    },
    {
      id: "status",
      accessorKey: "isPaused",
      header: tGlobal("common.actions.status"),
      enableSorting: false,
      enableResizing: true,
      size: 130,
      cell: ({ row }) => getStatusBadge(row.original),
    },
    {
      id: "concurrency",
      accessorKey: "concurrency",
      header: t("table.concurrency"),
      enableSorting: false,
      enableResizing: true,
      size: 120,
      cell: ({ row }) => (
        <div className="text-end">
          <Badge variant="secondary" className="font-mono">
            {row.original.concurrency}
          </Badge>
        </div>
      ),
    },
    {
      id: "waiting",
      header: t("table.waiting"),
      enableSorting: false,
      enableResizing: true,
      size: 100,
      cell: ({ row }) => (
        <div className="text-end">
          {row.original.counts?.waiting ? (
            <Badge className="border-warning bg-warning text-white hover:bg-warning/90">
              {row.original.counts.waiting}
            </Badge>
          ) : (
            (row.original.counts?.waiting ?? "-")
          )}
        </div>
      ),
    },
    {
      id: "active",
      header: tGlobal("common.fields.isActive"),
      enableSorting: false,
      enableResizing: true,
      size: 100,
      cell: ({ row }) => (
        <div className="text-end">
          {row.original.counts?.active ? (
            <Badge>{row.original.counts.active}</Badge>
          ) : (
            (row.original.counts?.active ?? "-")
          )}
        </div>
      ),
    },
    {
      id: "completed",
      header: tGlobal("common.fields.completed"),
      enableSorting: false,
      enableResizing: true,
      size: 110,
      cell: ({ row }) => (
        <div className="text-end">{row.original.counts?.completed ?? "-"}</div>
      ),
    },
    {
      id: "failed",
      header: t("table.failed"),
      enableSorting: false,
      enableResizing: true,
      size: 100,
      cell: ({ row }) => (
        <div className="text-end">
          {row.original.counts?.failed ? (
            <Badge variant="destructive">{row.original.counts.failed}</Badge>
          ) : (
            (row.original.counts?.failed ?? "-")
          )}
        </div>
      ),
    },
    {
      id: "delayed",
      header: tGlobal("milestones.statusLabels.delayed"),
      enableSorting: false,
      enableResizing: true,
      size: 100,
      cell: ({ row }) => (
        <div className="text-end">
          {row.original.counts?.delayed ? (
            <Badge className="border-warning bg-warning text-white hover:bg-warning/90">
              {row.original.counts.delayed}
            </Badge>
          ) : (
            (row.original.counts?.delayed ?? "-")
          )}
        </div>
      ),
    },
    {
      id: "actions",
      header: tGlobal("common.actions.actionsLabel"),
      enableSorting: false,
      enableResizing: true,
      enableHiding: false,
      meta: { isPinned: "right" },
      size: 110,
      cell: ({ row }) => {
        const queue = row.original;
        return (
          <div
            className="flex justify-end gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {queue.isPaused ? (
              <Button
                variant="ghost"
                className="px-2 py-1 h-auto"
                onClick={() => performQueueAction(queue.name, "resume")}
                disabled={actionInProgress === queue.name}
              >
                <Play className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                className="px-2 py-1 h-auto"
                onClick={() => performQueueAction(queue.name, "pause")}
                disabled={actionInProgress === queue.name}
              >
                <Pause className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="destructive"
              className="px-2 py-1 h-auto"
              onClick={() => performQueueAction(queue.name, "clean", true)}
              disabled={actionInProgress === queue.name}
            >
              <Trash className="h-4 w-4" />
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <SectionHeader className="flex items-center gap-2">
              <CardTitle>{t("title")}</CardTitle>
              <HelpPopover helpKey="queues" />
            </SectionHeader>
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
              <span className="ms-2">{tGlobal("common.actions.refresh")}</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Alert className="mb-4">
            <Activity className="h-4 w-4" />
            <AlertTitle>{t("concurrency.title")}</AlertTitle>
            <AlertDescription>
              {t("concurrency.description")}{" "}
              {t("concurrency.configureDescription")}
            </AlertDescription>
          </Alert>
          <DataTable
            columns={queueColumns}
            data={queueRows}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            onTestCaseClick={(id) => setSelectedQueue(String(id))}
            isLoading={loading && queues.length === 0}
          />
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
              <AlertDescription>{t("actions.irreversible")}</AlertDescription>
            </Alert>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDialog(null)}>
                {tGlobal("common.cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={() =>
                  performQueueAction(
                    confirmDialog.queueName,
                    confirmDialog.action
                  )
                }
              >
                {tGlobal("common.actions.confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
