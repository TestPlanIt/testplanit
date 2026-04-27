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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import {
  type SendTestWebhookResult,
  createOrRotateJiraWebhook,
  deleteJiraWebhook,
  sendTestWebhook,
} from "~/app/actions/webhook-config";
import { useFindFirstWebhookConfig, useUpdateWebhookConfig } from "~/lib/hooks";
import { redactWebhookUrl } from "~/lib/webhooks/redaction";

interface WebhookConfigFormProps {
  projectId: number;
}

interface RevealedSecret {
  url: string;
  secret: string;
}

interface TestResultDisplay {
  ok: boolean;
  statusCode: number;
  outcome?: SendTestWebhookResult["outcome"];
  error?: string;
}

/**
 * Project admin form for configuring a Jira INBOUND webhook (D-18 / D-19 / D-20).
 *
 * Reads via the auto-generated `useFindFirstWebhookConfig` hook (ZenStack
 * policy enforces project-admin gate; non-admins see no row, so the form
 * stays in "no config" mode invisibly to them).
 *
 * Writes — token mint, secret encryption, and the self-loop synthetic ping —
 * all run server-side via `~/app/actions/webhook-config` (WARNING #8). The
 * browser only ever holds the freshly-revealed `{ url, secret }` pair in
 * `useState`, never receives the secret again on subsequent loads.
 *
 * SC#5 demo lock surfaces naturally: the form just renders whatever
 * `outcome` the server action returns. With a byte-identical synthetic
 * payload, the receiver returns 'synthetic' on the first click and
 * 'duplicate' on the second.
 */
export function WebhookConfigForm({ projectId }: WebhookConfigFormProps) {
  const t = useTranslations("projects.settings.integrations.webhooks");
  const tActions = useTranslations("common.actions");
  const tCommon = useTranslations("common");

  // Explicit `select` excludes the encrypted `secret` field — the form never
  // displays it, but auto-generated ZenStack hooks ship every scalar by
  // default. Don't send encrypted secrets to the browser even if encrypted
  // at rest (HI-01).
  const {
    data: webhook,
    isLoading,
    refetch,
  } = useFindFirstWebhookConfig({
    where: { projectId, adapterType: "JIRA", direction: "INBOUND" },
    select: {
      id: true,
      projectId: true,
      adapterType: true,
      direction: true,
      token: true,
      isActive: true,
      lastReceivedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const { mutateAsync: updateWebhookConfig } = useUpdateWebhookConfig();

  const [revealed, setRevealed] = useState<RevealedSecret | null>(null);
  const [testResult, setTestResult] = useState<TestResultDisplay | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [rotateDialogOpen, setRotateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  if (isLoading) {
    return null;
  }

  // Non-admin members see no row from the policy-enforced read; render
  // nothing so they don't see a form they can't use.
  const handleCreate = async () => {
    setIsCreating(true);
    setTestResult(null);
    try {
      const result = await createOrRotateJiraWebhook(projectId);
      if (result.success && result.url && result.secret) {
        setRevealed({ url: result.url, secret: result.secret });
        await refetch();
      } else {
        toast.error(result.error ?? t("saveError"));
      }
    } finally {
      setIsCreating(false);
    }
  };

  const performRotate = async () => {
    if (!webhook) return;
    setRotateDialogOpen(false);
    setIsRotating(true);
    setTestResult(null);
    try {
      const result = await createOrRotateJiraWebhook(projectId);
      if (result.success && result.url && result.secret) {
        setRevealed({ url: result.url, secret: result.secret });
        await refetch();
      } else {
        toast.error(result.error ?? t("saveError"));
      }
    } finally {
      setIsRotating(false);
    }
  };

  const performDelete = async () => {
    if (!webhook) return;
    setDeleteDialogOpen(false);
    setIsDeleting(true);
    setRevealed(null);
    setTestResult(null);
    try {
      const result = await deleteJiraWebhook(webhook.id);
      if (!result.success) {
        toast.error(result.error ?? t("saveError"));
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggleActive = async (next: boolean) => {
    if (!webhook) return;
    try {
      await updateWebhookConfig({
        where: { id: webhook.id },
        data: { isActive: next },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveError"));
    }
  };

  const handleSendTest = async () => {
    if (!webhook) return;
    setIsSendingTest(true);
    try {
      const result = await sendTestWebhook(webhook.id);
      setTestResult({
        ok: result.ok,
        statusCode: result.statusCode,
        outcome: result.outcome,
        error: result.error,
      });
    } finally {
      setIsSendingTest(false);
    }
  };

  const copy = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(message);
    } catch {
      // Clipboard access can fail in non-secure contexts; surface but don't crash.
      toast.error(t("saveError"));
    }
  };

  const renderTestResult = () => {
    if (!testResult) return null;
    const message = testResult.ok
      ? t("testSuccess", {
          statusCode: testResult.statusCode,
          outcome: testResult.outcome ?? "",
        })
      : t("testFailure", {
          statusCode: testResult.statusCode,
          error: testResult.error ?? "",
        });
    return (
      <div
        data-testid="webhook-test-result"
        className="text-sm rounded-md border px-3 py-2"
      >
        {message}
      </div>
    );
  };

  return (
    <Card data-testid="webhook-config-form">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {revealed && (
          <div className="space-y-3 rounded-md border border-primary/40 bg-muted/30 p-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">
                {t("url")}
              </div>
              <div className="flex items-center gap-2">
                <code
                  data-testid="webhook-url"
                  className="flex-1 break-all text-xs"
                >
                  {revealed.url}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copy(revealed.url, t("urlCopied"))}
                  aria-label={t("copyUrl")}
                >
                  {tActions("copyLink")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("urlHelp")}</p>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">
                {t("secret")}
              </div>
              <div className="flex items-center gap-2">
                <code
                  data-testid="webhook-secret"
                  className="flex-1 break-all text-xs"
                >
                  {revealed.secret}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copy(revealed.secret, t("secretCopied"))}
                  aria-label={t("copySecret")}
                >
                  {tActions("copy")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("secretHelp")}</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-primary/20">
              <p className="text-xs text-muted-foreground flex-1 min-w-[200px]">
                {t("nextSteps")}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="webhook-reveal-done-button"
                onClick={() => setRevealed(null)}
              >
                {t("revealDone")}
              </Button>
            </div>
          </div>
        )}

        {!webhook && !revealed && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted-foreground">{t("noConfig")}</p>
            <Button
              type="button"
              data-testid="webhook-create-button"
              onClick={handleCreate}
              disabled={isCreating}
            >
              {t("createButton")}
            </Button>
          </div>
        )}

        {webhook && !revealed && (
          <div className="space-y-2">
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">
                {t("url")}
              </div>
              <code
                data-testid="webhook-url"
                className="block break-all text-xs"
              >
                {redactWebhookUrl(
                  `${typeof window !== "undefined" ? window.location.origin : ""}/api/webhooks/${webhook.token}`
                )}
              </code>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">
                {t("secret")}
              </div>
              <code
                data-testid="webhook-secret"
                className="block text-xs text-muted-foreground"
              >
                {t("secretMasked")}
              </code>
            </div>
            <div className="text-xs text-muted-foreground">
              {webhook.lastReceivedAt
                ? t("lastReceived", {
                    timestamp: new Date(webhook.lastReceivedAt).toISOString(),
                  })
                : t("lastReceivedNever")}
            </div>
          </div>
        )}

        {webhook && (
          <div className="flex items-center gap-2">
            <Switch
              checked={webhook.isActive}
              onCheckedChange={handleToggleActive}
              aria-label={t("isActive")}
            />
            <span className="text-sm">{t("isActive")}</span>
          </div>
        )}

        {webhook && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              data-testid="webhook-send-test-button"
              onClick={handleSendTest}
              disabled={isSendingTest}
            >
              {t("sendTest")}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="webhook-rotate-button"
              onClick={() => setRotateDialogOpen(true)}
              disabled={isRotating}
            >
              {t("rotateSecret")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              data-testid="webhook-delete-button"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={isDeleting}
            >
              {tActions("delete")}
            </Button>
          </div>
        )}

        {renderTestResult()}
      </CardContent>

      <AlertDialog open={rotateDialogOpen} onOpenChange={setRotateDialogOpen}>
        <AlertDialogContent data-testid="webhook-rotate-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rotateConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("rotateConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="webhook-rotate-dialog-cancel">
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="webhook-rotate-dialog-confirm"
              onClick={performRotate}
            >
              {t("rotateSecret")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent data-testid="webhook-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="webhook-delete-dialog-cancel">
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="webhook-delete-dialog-confirm"
              onClick={performDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tActions("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
