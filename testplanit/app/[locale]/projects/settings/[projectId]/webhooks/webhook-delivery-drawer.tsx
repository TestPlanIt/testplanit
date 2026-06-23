"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DateFormatter } from "@/components/DateFormatter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { replayWebhookDelivery } from "~/app/actions/webhook-config";

const EVENT_LABEL_KEYS: Record<string, string> = {
  "test_run.created": "events.testRunCreated",
  "test_run.state_changed": "events.testRunStateChanged",
  "test_run.completed": "events.testRunCompleted",
  "test_run.duplicated": "events.testRunDuplicated",
  "test_run.result_added": "events.testRunResultAdded",
  "session.created": "events.sessionCreated",
  "session.state_changed": "events.sessionStateChanged",
  "session.completed": "events.sessionCompleted",
  "session.duplicated": "events.sessionDuplicated",
  "session.result_added": "events.sessionResultAdded",
  "issue.created": "events.issueCreated",
  "issue.updated": "events.issueUpdated",
  "issue.deleted": "events.issueDeleted",
  "case.created": "events.caseCreated",
  "case.updated": "events.caseUpdated",
  "case.deleted": "events.caseDeleted",
  "jira:issue_created": "events.jiraIssueCreated",
  "jira:issue_updated": "events.jiraIssueUpdated",
  "jira:issue_deleted": "events.jiraIssueDeleted",
  issues: "events.githubIssues",
  pull_request: "events.githubPullRequest",
  push: "events.githubPush",
  issue_comment: "events.githubIssueComment",
  "workitem.created": "events.adoWorkitemCreated",
  "workitem.updated": "events.adoWorkitemUpdated",
  "workitem.deleted": "events.adoWorkitemDeleted",
  "webhook.test": "events.webhookTest",
};

function eventLabelKey(eventType: string | null | undefined): string | null {
  if (!eventType) return null;
  return EVENT_LABEL_KEYS[eventType] ?? null;
}

interface WebhookDeliveryDrawerProps {
  deliveryId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReplaySuccess?: () => void;
}

/**
 * Plan 04-07 Scope A — modal for a single WebhookDelivery row.
 *
 * Lazy-loads the full record only when the modal opens — the deliveries list
 * query selects a small column set for speed; the modal fetches the same
 * minimal shape via `useClientQueries(schema).webhookDelivery.useFindUnique` so it's small and fast.
 *
 * Conditional rendering by direction (D-17a / D-17b — outbound-only replay):
 *   OUTBOUND → eventId field + Replay button + AlertDialog confirm
 *   INBOUND  → payloadDigest field + gray info banner; NO Replay button
 *
 * Replay flow handles `{ ok: false, reason: "inbound_replay_not_supported" }`
 * defensively (the UI prevents firing the action for inbound rows, but the
 * server action keeps the same contract for direct API callers per
 * T-04-07-07).
 */
export function WebhookDeliveryDrawer({
  deliveryId,
  open,
  onOpenChange,
  onReplaySuccess,
}: WebhookDeliveryDrawerProps) {
  const t = useTranslations("projects.settings.webhooks");
  const tCommon = useTranslations("common");
  const tGlobal = useTranslations();
  const { data: session } = useSession();
  const [replayConfirmOpen, setReplayConfirmOpen] = useState(false);
  const [replayInFlight, setReplayInFlight] = useState(false);

  const { data: delivery, isLoading } = useClientQueries(schema).webhookDelivery.useFindUnique(
    {
      where: { id: deliveryId ?? "" },
      select: {
        id: true,
        webhookConfigId: true,
        webhookConfig: { select: { name: true, adapterType: true } },
        direction: true,
        adapterType: true,
        eventType: true,
        eventId: true,
        payloadDigest: true,
        statusCode: true,
        latencyMs: true,
        error: true,
        attempt: true,
        receivedAt: true,
        replayedFromDeliveryId: true,
      },
    },
    { enabled: !!deliveryId }
  );

  if (!deliveryId) return null;

  const isOutbound = delivery?.direction === "OUTBOUND";
  const isInbound = delivery?.direction === "INBOUND";

  async function performReplay() {
    if (!delivery) return;
    setReplayInFlight(true);
    try {
      const result = await replayWebhookDelivery(delivery.id);
      if (result.ok) {
        toast.success(t("toastReplaySuccess"));
        onReplaySuccess?.();
        onOpenChange(false);
        return;
      }
      if (result.reason === "inbound_replay_not_supported") {
        toast.error(t("toastReplayInboundNotSupported"));
        return;
      }
      toast.error(t("toastReplayFailed", { error: result.error ?? "" }));
    } finally {
      setReplayInFlight(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-3xl max-h-[80vh] overflow-hidden"
          data-testid="webhook-delivery-drawer"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {t("drawerTitle")}
              {delivery && (
                <Badge variant="outline">{delivery.direction}</Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {isLoading || !delivery ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {tGlobal("common.loading")}
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto pr-4">
              <div className="space-y-4 py-2 text-sm">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="overflow-hidden">
                    <label className="text-sm font-medium text-muted-foreground">
                      {t("drawerLabelEvent")}
                    </label>
                    <p
                      className="text-sm font-mono truncate"
                      data-testid="webhook-drawer-event-type"
                    >
                      {(() => {
                        const k = eventLabelKey(delivery.eventType);
                        return k
                          ? (t as unknown as (key: string) => string)(k)
                          : (delivery.eventType ?? "—");
                      })()}
                    </p>
                  </div>
                  <div className="overflow-hidden">
                    <label className="text-sm font-medium text-muted-foreground">
                      {t("drawerLabelDirection")}
                    </label>
                    <p
                      className="text-sm"
                      data-testid="webhook-drawer-direction"
                    >
                      {delivery.direction}
                    </p>
                  </div>
                  <div className="overflow-hidden">
                    <label className="text-sm font-medium text-muted-foreground">
                      {t("drawerLabelStatusCode")}
                    </label>
                    <p
                      className="text-sm"
                      data-testid="webhook-drawer-status-code"
                    >
                      {delivery.statusCode ?? "—"}
                    </p>
                  </div>
                  <div className="overflow-hidden">
                    <label className="text-sm font-medium text-muted-foreground">
                      {t("drawerLabelLatency")}
                    </label>
                    <p className="text-sm" data-testid="webhook-drawer-latency">
                      {delivery.latencyMs == null
                        ? t("drawerLatencyUnknown")
                        : t("drawerLatencyValue", { ms: delivery.latencyMs })}
                    </p>
                  </div>
                  <div className="overflow-hidden">
                    <label className="text-sm font-medium text-muted-foreground">
                      {t("drawerLabelAttempt")}
                    </label>
                    <p className="text-sm" data-testid="webhook-drawer-attempt">
                      {delivery.attempt}
                    </p>
                  </div>
                  <div className="overflow-hidden">
                    <label className="text-sm font-medium text-muted-foreground">
                      {t("drawerLabelReceivedAt")}
                    </label>
                    <p
                      className="text-sm"
                      data-testid="webhook-drawer-received-at"
                    >
                      <DateFormatter
                        date={delivery.receivedAt}
                        formatString={
                          session?.user?.preferences?.dateFormat
                            ? `${session.user.preferences.dateFormat} ${session.user.preferences.timeFormat || "HH:mm"}`
                            : undefined
                        }
                        timezone={
                          session?.user?.preferences?.timezone || "Etc/UTC"
                        }
                      />
                    </p>
                  </div>
                </div>

                <Separator />

                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    {t("drawerLabelError")}
                  </label>
                  <p
                    className="text-sm break-all"
                    data-testid="webhook-drawer-error"
                  >
                    {delivery.error ?? t("drawerNoError")}
                  </p>
                </div>

                {isOutbound && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      {t("drawerLabelEventId")}
                    </label>
                    <code
                      data-testid="webhook-drawer-event-id"
                      className="block break-all font-mono text-xs"
                    >
                      {delivery.eventId ?? "—"}
                    </code>
                  </div>
                )}

                {isInbound && (
                  <>
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        {t("drawerLabelPayloadDigest")}
                      </label>
                      <code
                        data-testid="webhook-drawer-payload-digest"
                        className="block break-all font-mono text-xs"
                      >
                        {delivery.payloadDigest ?? "—"}
                      </code>
                    </div>
                    <div
                      data-testid="webhook-delivery-replay-not-supported"
                      className="rounded border border-muted bg-muted/40 p-3 text-sm text-muted-foreground"
                    >
                      {t("drawerInboundReplayNotSupported")}
                    </div>
                  </>
                )}

                {delivery.replayedFromDeliveryId && (
                  <div data-testid="webhook-drawer-replayed-from">
                    {t("drawerReplayedFrom", {
                      id: delivery.replayedFromDeliveryId,
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {isOutbound && delivery && (
            <DialogFooter>
              <Button
                type="button"
                data-testid="webhook-drawer-replay-button"
                onClick={() => setReplayConfirmOpen(true)}
                disabled={replayInFlight}
              >
                {t("drawerReplayButton")}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={replayConfirmOpen} onOpenChange={setReplayConfirmOpen}>
        <AlertDialogContent data-testid="webhook-replay-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("replayConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {delivery
                ? t("replayConfirm", {
                    adapterType: delivery.adapterType,
                    direction: delivery.direction,
                  })
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="webhook-replay-dialog-cancel">
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="webhook-replay-dialog-confirm"
              onClick={() => void performReplay()}
            >
              {t("replayAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
