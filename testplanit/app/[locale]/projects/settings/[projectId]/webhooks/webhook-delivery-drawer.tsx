"use client";

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
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { replayWebhookDelivery } from "~/app/actions/webhook-config";

export interface DeliveryDrawerRow {
  id: string;
  webhookConfigId: string;
  webhookConfig?: { name: string; adapterType: string } | null;
  direction: "INBOUND" | "OUTBOUND";
  adapterType: string;
  eventType: string | null;
  eventId: string | null;
  payloadDigest: string | null;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
  attempt: number;
  receivedAt: Date | string;
  replayedFromDeliveryId: string | null;
}

interface WebhookDeliveryDrawerProps {
  delivery: DeliveryDrawerRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReplaySuccess?: () => void;
}

/**
 * Plan 04-07 Scope A — drawer for a single WebhookDelivery row.
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
  delivery,
  open,
  onOpenChange,
  onReplaySuccess,
}: WebhookDeliveryDrawerProps) {
  const t = useTranslations("projects.settings.webhooks");
  const tCommon = useTranslations("common");
  const [replayConfirmOpen, setReplayConfirmOpen] = useState(false);
  const [replayInFlight, setReplayInFlight] = useState(false);

  if (!delivery) return null;

  // D-17a / D-17b — outbound is the only replay-able direction. The
  // companion check `direction === "INBOUND"` below renders the gray banner
  // and suppresses the Replay button entirely.
  const isOutbound = delivery.direction === "OUTBOUND";
  const isInbound = delivery.direction === "INBOUND";
  const receivedAtDate =
    delivery.receivedAt instanceof Date
      ? delivery.receivedAt
      : new Date(delivery.receivedAt);

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
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" data-testid="webhook-delivery-drawer">
          <SheetHeader>
            <SheetTitle>{t("drawerTitle")}</SheetTitle>
            <SheetDescription>
              {`${delivery.eventType ?? ""} · ${delivery.adapterType}`}
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-3 py-4 text-sm">
            <div>
              <span className="font-medium">{t("drawerLabelEvent")}:</span>{" "}
              <span data-testid="webhook-drawer-event-type">
                {delivery.eventType ?? "—"}
              </span>
            </div>
            <div>
              <span className="font-medium">{t("drawerLabelDirection")}:</span>{" "}
              <span data-testid="webhook-drawer-direction">
                {delivery.direction}
              </span>
            </div>
            <div>
              <span className="font-medium">{t("drawerLabelStatusCode")}:</span>{" "}
              <span data-testid="webhook-drawer-status-code">
                {delivery.statusCode ?? "—"}
              </span>
            </div>
            <div>
              <span className="font-medium">{t("drawerLabelLatency")}:</span>{" "}
              <span data-testid="webhook-drawer-latency">
                {`${delivery.latencyMs ?? "—"} ms`}
              </span>
            </div>
            <div>
              <span className="font-medium">{t("drawerLabelError")}:</span>{" "}
              <span data-testid="webhook-drawer-error">
                {delivery.error ?? t("drawerNoError")}
              </span>
            </div>
            <div>
              <span className="font-medium">{t("drawerLabelAttempt")}:</span>{" "}
              <span data-testid="webhook-drawer-attempt">
                {delivery.attempt}
              </span>
            </div>
            <div>
              <span className="font-medium">{t("drawerLabelReceivedAt")}:</span>{" "}
              <span data-testid="webhook-drawer-received-at">
                {receivedAtDate.toISOString()}
              </span>
            </div>

            {isOutbound && (
              <div>
                <span className="font-medium">{t("drawerLabelEventId")}:</span>{" "}
                <span data-testid="webhook-drawer-event-id">
                  {delivery.eventId ?? "—"}
                </span>
              </div>
            )}
            {isInbound && (
              <>
                <div>
                  <span className="font-medium">
                    {t("drawerLabelPayloadDigest")}:
                  </span>{" "}
                  <span data-testid="webhook-drawer-payload-digest">
                    {delivery.payloadDigest ?? "—"}
                  </span>
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

          {isOutbound && (
            <SheetFooter>
              <Button
                type="button"
                data-testid="webhook-drawer-replay-button"
                onClick={() => setReplayConfirmOpen(true)}
                disabled={replayInFlight}
              >
                {t("drawerReplayButton")}
              </Button>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={replayConfirmOpen} onOpenChange={setReplayConfirmOpen}>
        <AlertDialogContent data-testid="webhook-replay-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("replayConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("replayConfirm", {
                adapterType: delivery.adapterType,
                direction: delivery.direction,
              })}
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
