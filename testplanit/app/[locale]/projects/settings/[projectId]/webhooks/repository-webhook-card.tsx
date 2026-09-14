"use client";

import { CodeRepositoryName } from "@/components/CodeRepositoryName";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { WebhookAdapterIcon } from "@/components/webhooks/webhook-adapter-icon";
import {
  AlertTriangle,
  Check,
  Copy,
  Inbox,
  RotateCw,
  Save,
  Send,
  Trash,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
  type SendTestWebhookResult,
  createOrRotateCodeRepositoryWebhook,
  deleteInboundWebhook,
  sendTestWebhook,
  setWebhookActive,
  updateCodeRepositoryWebhookEvents,
} from "~/app/actions/webhook-config";
import {
  CODE_EVENT_BRANCH_PUSH,
  CODE_EVENT_PULL_REQUEST,
  CODE_EVENT_PUSH,
} from "~/lib/webhooks/codeChangeEvents";
import { redactWebhookUrl } from "~/lib/webhooks/redaction";
import type { AdapterType } from "~/zenstack/models";
import {
  REPOSITORY_SETUP_KEY,
  hasRotatableSecret,
  healthBadgeVariant,
  type EndpointHealth,
} from "./inbound-adapters";

export interface RepositoryWebhookRow {
  id: string;
  token: string;
  adapterType: AdapterType;
  isActive: boolean;
  subscribedEvents: string[];
  baseBranch: string | null;
  endpointHealth: EndpointHealth;
  lastReceivedAt: Date | string | null;
  codeRepositoryConfig: {
    id: number;
    branch: string | null;
    repository: { id: number; name: string; provider: string };
  };
}

interface RepositoryWebhookCardProps {
  projectId: number;
  hook: RepositoryWebhookRow;
  /** Refetch the inbound list after any change. */
  onChanged: () => Promise<unknown> | void;
}

interface Revealed {
  url: string;
  secret: string | null;
}

/**
 * One inbound webhook bound to an Impact repository connection. The
 * repository's pull requests and pushes start analyses; the switches turn
 * each event on or off, and rotation hands out a fresh URL and secret.
 */
export function RepositoryWebhookCard({
  projectId,
  hook,
  onChanged,
}: RepositoryWebhookCardProps) {
  const t = useTranslations("projects.settings.webhooks");
  const tActions = useTranslations("common.actions");
  const tCommon = useTranslations("common");
  const tAutomation = useTranslations("automation.settings");
  const { data: session } = useSession();
  const preferences = session?.user?.preferences;
  const dateTimeFormat = preferences?.dateFormat
    ? `${preferences.dateFormat} ${preferences.timeFormat || "HH:mm"}`
    : undefined;

  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [baseBranchDraft, setBaseBranchDraft] = useState(hook.baseBranch ?? "");
  const [testPending, setTestPending] = useState(false);
  const [testResult, setTestResult] = useState<SendTestWebhookResult | null>(
    null
  );

  const connection = hook.codeRepositoryConfig;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const pullRequestsOn = hook.subscribedEvents.includes(
    CODE_EVENT_PULL_REQUEST
  );
  const pushesOn = hook.subscribedEvents.includes(CODE_EVENT_PUSH);
  const branchPushesOn = hook.subscribedEvents.includes(CODE_EVENT_BRANCH_PUSH);
  const effectiveBranch =
    baseBranchDraft.trim() || hook.baseBranch || connection.branch || null;
  const baseBranchDirty = baseBranchDraft.trim() !== (hook.baseBranch ?? "");
  const setupKey = REPOSITORY_SETUP_KEY[hook.adapterType];

  async function copy(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(message);
    } catch {
      toast.error(tCommon("errors.error"));
    }
  }

  async function toggleEvent(event: string, on: boolean) {
    const next = on
      ? [...new Set([...hook.subscribedEvents, event])]
      : hook.subscribedEvents.filter((item) => item !== event);
    const result = await updateCodeRepositoryWebhookEvents({
      projectId,
      webhookConfigId: hook.id,
      subscribedEvents: next,
    });
    if (!result.success) {
      toast.error(result.error ?? t("saveError"));
      return;
    }
    await onChanged();
  }

  async function saveBaseBranch() {
    const result = await updateCodeRepositoryWebhookEvents({
      projectId,
      webhookConfigId: hook.id,
      baseBranch: baseBranchDraft.trim() || null,
    });
    if (!result.success) {
      toast.error(result.error ?? t("saveError"));
      return;
    }
    await onChanged();
  }

  async function sendTest() {
    setTestPending(true);
    try {
      setTestResult(await sendTestWebhook(hook.id));
    } finally {
      setTestPending(false);
    }
  }

  async function toggleActive(next: boolean) {
    const result = await setWebhookActive(hook.id, next);
    if (!result.success) {
      toast.error(result.error ?? t("saveError"));
      return;
    }
    await onChanged();
  }

  async function rotate() {
    setRotateOpen(false);
    setBusy(true);
    try {
      const result = await createOrRotateCodeRepositoryWebhook({
        projectId,
        codeRepositoryConfigId: connection.id,
      });
      if (!result.success || !result.url) {
        toast.error(result.error ?? t("saveError"));
        return;
      }
      setRevealed({ url: result.url, secret: result.secret ?? null });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setDeleteOpen(false);
    const result = await deleteInboundWebhook({
      webhookConfigId: hook.id,
      projectId,
    });
    if (!result.success) {
      toast.error(result.error ?? t("saveError"));
      return;
    }
    await onChanged();
  }

  function renderRevealed(rev: Revealed) {
    return (
      <div
        className="space-y-3 rounded-md border border-primary/40 bg-muted/30 p-3"
        data-testid="webhook-inbound-revealed-box"
      >
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md bg-destructive px-3 py-2 text-xs font-medium text-destructive-foreground"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t("revealedShownOnceWarning")}</span>
        </div>
        {setupKey && (
          <p className="text-xs text-muted-foreground">{t(setupKey as any)}</p>
        )}
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">
            {t("url")}
          </div>
          <div className="flex items-center gap-2">
            <code
              data-testid="webhook-url"
              className="flex-1 break-all text-xs"
            >
              {rev.url}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => copy(rev.url, t("urlCopied"))}
              aria-label={t("copyUrl")}
            >
              <Copy className="h-4 w-4" />
              <span>{tActions("copyLink")}</span>
            </Button>
          </div>
        </div>
        {rev.secret !== null && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">
              {t("secret")}
            </div>
            <div className="flex items-center gap-2">
              <code
                data-testid="webhook-secret"
                className="flex-1 break-all text-xs"
              >
                {rev.secret}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copy(rev.secret!, t("secretCopied"))}
                aria-label={t("copySecret")}
              >
                <Copy className="h-4 w-4" />
                <span>{tActions("copy")}</span>
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <Card
      data-testid={`webhook-inbound-card-repository-${connection.id}`}
      className={hook.isActive ? undefined : "opacity-60 transition-opacity"}
    >
      <CardHeader>
        <div className="flex items-center gap-3">
          <WebhookAdapterIcon adapterType={hook.adapterType} />
          <div className="min-w-0 flex-1">
            <CardTitle>
              <CodeRepositoryName
                name={connection.repository.name}
                provider={connection.repository.provider}
                branch={connection.branch}
              />
            </CardTitle>
            <CardDescription className="mt-1 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-xs">
                <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t("directionInbound")}</span>
              </span>
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <Switch
                checked={hook.isActive}
                onCheckedChange={(next: boolean) => void toggleActive(next)}
                aria-label={t("isActive")}
              />
              <span className="text-sm text-muted-foreground">
                {t("isActive")}
              </span>
            </div>
            <Badge
              variant={healthBadgeVariant(hook.endpointHealth)}
              data-testid={`webhook-health-badge-repository-${connection.id}`}
            >
              {t(`healthBadge.${hook.endpointHealth}` as any)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {revealed && renderRevealed(revealed)}

        {!revealed && (
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">
                  {t("url")}
                </div>
                <code
                  data-testid="webhook-url"
                  className="block break-all text-xs"
                >
                  {redactWebhookUrl(`${origin}/api/webhooks/${hook.token}`)}
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
                {hook.lastReceivedAt ? (
                  <>
                    {t("lastReceivedLabel")}{" "}
                    <DateFormatter
                      date={hook.lastReceivedAt}
                      formatString={dateTimeFormat}
                      timezone={preferences?.timezone}
                    />
                  </>
                ) : (
                  t("lastReceivedNever")
                )}
              </div>
            </div>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor={`webhook-repository-base-branch-${hook.id}`}>
                  {t("codeRepos.baseBranch")}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`webhook-repository-base-branch-${hook.id}`}
                    data-testid="webhook-repository-base-branch"
                    value={baseBranchDraft}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setBaseBranchDraft(e.target.value)
                    }
                    placeholder={
                      connection.branch ?? tAutomation("defaultRefDefault")
                    }
                  />
                  {baseBranchDirty && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void saveBaseBranch()}
                      data-testid="webhook-repository-base-branch-save"
                    >
                      <Save className="h-4 w-4" />
                      <span>{tActions("save")}</span>
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("codeRepos.baseBranchHelp")}
                </p>
              </div>
              <Label className="flex items-start gap-3">
                <Switch
                  checked={pullRequestsOn}
                  onCheckedChange={(on) =>
                    void toggleEvent(CODE_EVENT_PULL_REQUEST, on)
                  }
                  data-testid="webhook-repository-event-pull-request"
                />
                <span className="space-y-0.5">
                  <span className="block font-medium">
                    {t("codeRepos.eventPullRequest")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t("codeRepos.eventPullRequestHelp")}
                  </span>
                </span>
              </Label>
              <Label className="flex items-start gap-3">
                <Switch
                  checked={pushesOn}
                  onCheckedChange={(on) =>
                    void toggleEvent(CODE_EVENT_PUSH, on)
                  }
                  data-testid="webhook-repository-event-push"
                />
                <span className="space-y-0.5">
                  <span className="block font-medium">
                    {effectiveBranch
                      ? t("codeRepos.eventPush", { branch: effectiveBranch })
                      : t("codeRepos.eventPushDefault")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t("codeRepos.eventPushHelp")}
                  </span>
                </span>
              </Label>
              <Label className="flex items-start gap-3">
                <Switch
                  checked={branchPushesOn}
                  onCheckedChange={(on) =>
                    void toggleEvent(CODE_EVENT_BRANCH_PUSH, on)
                  }
                  data-testid="webhook-repository-event-branch-push"
                />
                <span className="space-y-0.5">
                  <span className="block font-medium">
                    {t("codeRepos.eventBranchPush")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t("codeRepos.eventBranchPushHelp")}
                  </span>
                </span>
              </Label>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={() => void sendTest()}
            disabled={testPending}
            data-testid="webhook-send-test-button"
          >
            <Send className="h-4 w-4" />
            <span>{t("sendTest")}</span>
          </Button>
          {hasRotatableSecret(hook.adapterType) && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setRotateOpen(true)}
              disabled={busy}
              data-testid="webhook-rotate-button"
            >
              <RotateCw className="h-4 w-4" />
              <span>{t("rotateSecret")}</span>
            </Button>
          )}
          <div className="ms-auto flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
              data-testid="webhook-delete-button"
            >
              <Trash className="h-4 w-4" />
              <span>{tActions("delete")}</span>
            </Button>
            {revealed && (
              <Button
                type="button"
                onClick={() => setRevealed(null)}
                data-testid="webhook-reveal-done-button"
              >
                <Check className="h-4 w-4" />
                <span>{t("revealDone")}</span>
              </Button>
            )}
          </div>
        </div>

        {testResult && (
          <div
            data-testid="webhook-test-result"
            className="rounded-md border px-3 py-2 text-sm"
          >
            {testResult.ok
              ? t("testSuccess", {
                  statusCode: testResult.statusCode,
                  outcome: testResult.outcome ?? "",
                })
              : t("testFailure", {
                  statusCode: testResult.statusCode,
                  error: testResult.error ?? "",
                })}
          </div>
        )}
      </CardContent>

      <AlertDialog open={rotateOpen} onOpenChange={setRotateOpen}>
        <AlertDialogContent data-testid="webhook-rotate-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rotateConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("codeRepos.rotateConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="webhook-rotate-dialog-cancel">
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="webhook-rotate-dialog-confirm"
              onClick={() => void rotate()}
            >
              {t("rotateSecret")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent data-testid="webhook-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("codeRepos.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="webhook-delete-dialog-cancel">
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="webhook-delete-dialog-confirm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void remove()}
            >
              {tActions("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
