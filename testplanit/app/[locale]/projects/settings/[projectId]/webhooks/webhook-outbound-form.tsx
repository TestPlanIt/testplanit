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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  createOutboundWebhook,
  deleteOutboundWebhook,
  extendRetiringSecret,
  retireOutboundSecretNow,
  rotateOutboundSecret,
  sendTestOutboundWebhook,
  setWebhookActive,
  updateOutboundSubscriptions,
} from "~/app/actions/webhook-config";
import { useFindManyWebhookConfig } from "~/lib/hooks";
import { isSlackWebhookUrl } from "~/lib/webhooks/slack-url-detection";

interface WebhookOutboundFormProps {
  projectId: number;
}

/**
 * Phase 2 event catalog (D-09..D-13). Three sections; the UI groups events
 * under section headers per D-08, with a per-section "Select all" toggle.
 *
 * Reserved verbs (D-13): created, updated, deleted, state_changed, completed,
 * duplicated, result_added.
 */
const EVENT_CATALOG = {
  testRunsAndSessions: [
    "test_run.created",
    "test_run.state_changed",
    "test_run.completed",
    "test_run.duplicated",
    "test_run.result_added",
    "session.created",
    "session.state_changed",
    "session.completed",
    "session.duplicated",
    "session.result_added",
  ],
  issues: ["issue.created", "issue.updated", "issue.deleted"],
  cases: ["case.created", "case.updated", "case.deleted"],
} as const;

const DEFAULT_PRESET: string[] = ["test_run.completed", "issue.created"];

/**
 * Outbound config row shape returned by `useFindManyWebhookConfig`. The select
 * clause INCLUDES `name` and `url` (Plan 02-01 columns; Blocker 4 fix), and
 * EXCLUDES the encrypted `secret` column (HI-01).
 */
interface OutboundConfig {
  id: string;
  projectId: number;
  adapterType: string;
  direction: string;
  name: string | null;
  url: string | null;
  isActive: boolean;
  subscribedEvents: string[];
  endpointHealth: string | null;
  createdAt: Date;
  updatedAt: Date;
  secrets?: Array<{
    id: string;
    activatedAt: Date;
    retiredAt: Date | null;
    autoRetireAt: Date | null;
  }>;
}

/**
 * Project admin form for OUTBOUND webhook configs (Phase 2 / Plan 02-07).
 *
 * Renders a list of zero-to-N outbound configs (typically Slack URL +
 * generic-HMAC URL = a normal setup) with per-config Card showing the admin
 * label (`config.name`), URL, subscriptions, rotation panel (HMAC only),
 * send-test, and delete. All confirmations use shadcn AlertDialog (D-31) —
 * native browser confirms are forbidden. Auto-detect of Slack vs Generic
 * HMAC happens client-side via `isSlackWebhookUrl()` so the admin sees the
 * badge BEFORE submitting (D-29).
 *
 * HI-01: the `secret` column is explicitly excluded from the read select
 * clause; only post-create / post-rotate plaintext secrets reach the
 * browser, and only via the server-action return value.
 */
export function WebhookOutboundForm({ projectId }: WebhookOutboundFormProps) {
  const t = useTranslations("projects.settings.webhooks");
  const tCommon = useTranslations("common");
  const tActions = useTranslations("common.actions");

  const { data, isLoading, refetch } = useFindManyWebhookConfig({
    where: { projectId, direction: "OUTBOUND" },
    select: {
      id: true,
      projectId: true,
      adapterType: true,
      direction: true,
      name: true, // Blocker 4 — admin label, used as Card title
      url: true, // Blocker 4 — destination URL (Plan 02-01 column)
      isActive: true,
      subscribedEvents: true,
      endpointHealth: true,
      createdAt: true,
      updatedAt: true,
      // secret column intentionally excluded — HI-01
      secrets: {
        select: {
          id: true,
          activatedAt: true,
          retiredAt: true,
          autoRetireAt: true,
          // secret column intentionally excluded
        },
      },
    },
  });

  const configs = (data ?? []) as unknown as OutboundConfig[];

  // ─── Create form local state ──────────────────────────────────────────
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createUrl, setCreateUrl] = useState("");
  const [createSubscriptions, setCreateSubscriptions] =
    useState<string[]>(DEFAULT_PRESET);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);

  const detectedAdapterKey = useMemo(
    () =>
      isSlackWebhookUrl(createUrl)
        ? "outboundDetectedSlack"
        : "outboundDetectedHmac",
    [createUrl]
  );

  // ─── Per-config dialog state ──────────────────────────────────────────
  const [rotateDialogConfigId, setRotateDialogConfigId] = useState<
    string | null
  >(null);
  const [deleteDialogConfigId, setDeleteDialogConfigId] = useState<
    string | null
  >(null);
  const [retireDialogSecretId, setRetireDialogSecretId] = useState<
    string | null
  >(null);
  const [postRotateSecret, setPostRotateSecret] = useState<string | null>(null);

  // ─── Send-test results per config ─────────────────────────────────────
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; eventId?: string; error?: string }>
  >({});

  // ─── Handlers ─────────────────────────────────────────────────────────

  async function handleCreate() {
    // Client-side guard so the user gets inline feedback rather than a
    // server-side toast. The server action also validates (Plan 02-06).
    if (createName.trim().length === 0) {
      toast.error(t("outboundCreateNameRequired"));
      return;
    }
    setIsSubmittingCreate(true);
    try {
      const result = await createOutboundWebhook({
        projectId,
        name: createName.trim(), // Blocker 4 — forwarded to server action
        url: createUrl,
        subscribedEvents: createSubscriptions,
      });
      if (!result.success) {
        toast.error(result.error ?? t("outboundCreateError"));
        return;
      }
      toast.success(t("outboundCreateSuccess"));
      if (result.secret) {
        setRevealedSecret(result.secret); // HMAC plaintext shown ONCE
      }
      setCreating(false);
      setCreateName("");
      setCreateUrl("");
      setCreateSubscriptions(DEFAULT_PRESET);
      await refetch();
    } finally {
      setIsSubmittingCreate(false);
    }
  }

  async function handleRotate(configId: string) {
    const result = await rotateOutboundSecret(configId);
    setRotateDialogConfigId(null);
    if (!result.success) {
      toast.error(result.error ?? t("outboundRotateError"));
      return;
    }
    toast.success(t("outboundRotateSuccess"));
    if (result.secret) setPostRotateSecret(result.secret);
    await refetch();
  }

  async function handleDelete(configId: string) {
    const result = await deleteOutboundWebhook(configId);
    setDeleteDialogConfigId(null);
    if (!result.success) {
      toast.error(result.error ?? t("outboundDeleteError"));
      return;
    }
    toast.success(t("outboundDeleteSuccess"));
    await refetch();
  }

  async function handleRetireNow(secretId: string) {
    const result = await retireOutboundSecretNow(secretId);
    setRetireDialogSecretId(null);
    if (!result.success) {
      toast.error(result.error ?? t("outboundRetireError"));
      return;
    }
    toast.success(t("outboundRetireSuccess"));
    await refetch();
  }

  async function handleExtend(secretId: string) {
    const result = await extendRetiringSecret(secretId);
    if (!result.success) {
      toast.error(result.error ?? t("outboundExtendError"));
      return;
    }
    toast.success(t("outboundExtendSuccess"));
    await refetch();
  }

  async function handleSendTest(configId: string) {
    const result = await sendTestOutboundWebhook(configId);
    if (!result.success) {
      setTestResults((prev) => ({
        ...prev,
        [configId]: { ok: false, error: result.error },
      }));
      toast.error(result.error ?? t("outboundSendTestError"));
      return;
    }
    setTestResults((prev) => ({
      ...prev,
      [configId]: { ok: true, eventId: result.eventId },
    }));
    toast.success(t("outboundSendTestQueued"));
  }

  async function handleToggleActive(configId: string, next: boolean) {
    try {
      const result = await setWebhookActive(configId, next);
      if (!result.success) {
        toast.error(result.error ?? t("saveError"));
        return;
      }
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveError"));
    }
  }

  async function handleUpdateSubscriptions(
    configId: string,
    nextEvents: string[]
  ) {
    const result = await updateOutboundSubscriptions(configId, nextEvents);
    if (!result.success) {
      toast.error(result.error ?? t("saveError"));
      return;
    }
    await refetch();
  }

  // ─── Subscription checkbox helpers (create form) ──────────────────────

  function toggleEvent(eventName: string) {
    setCreateSubscriptions((prev) =>
      prev.includes(eventName)
        ? prev.filter((e) => e !== eventName)
        : [...prev, eventName]
    );
  }

  function toggleSection(section: keyof typeof EVENT_CATALOG) {
    const sectionEvents = EVENT_CATALOG[section];
    const allSelected = sectionEvents.every((e) =>
      createSubscriptions.includes(e)
    );
    if (allSelected) {
      setCreateSubscriptions((prev) =>
        prev.filter((e) => !sectionEvents.includes(e as never))
      );
    } else {
      setCreateSubscriptions((prev) => {
        const next = [...prev];
        sectionEvents.forEach((e) => {
          if (!next.includes(e)) next.push(e);
        });
        return next;
      });
    }
  }

  async function copy(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(message);
    } catch {
      toast.error(t("saveError"));
    }
  }

  // ─── Rendering ────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div data-testid="webhook-outbound-loading">{tCommon("loading")}</div>
    );
  }

  const renderCreateForm = () => (
    <Card data-testid="webhook-outbound-create-form">
      <CardHeader>
        <CardTitle>{t("outboundCreateTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="webhook-outbound-name-input">
            {t("outboundCreateName")}
          </Label>
          <Input
            id="webhook-outbound-name-input"
            data-testid="webhook-outbound-name-input"
            value={createName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setCreateName(e.target.value)
            }
            placeholder={t("outboundCreateNamePlaceholder")}
          />
          <p className="text-xs text-muted-foreground">
            {t("outboundCreateNameHelp")}
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="webhook-outbound-url-input">
            {t("outboundCreateUrl")}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="webhook-outbound-url-input"
              data-testid="webhook-outbound-url-input"
              value={createUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setCreateUrl(e.target.value)
              }
              placeholder={t("outboundCreateUrlPlaceholder")}
            />
            <Badge data-testid="webhook-outbound-detected-badge">
              {t(detectedAdapterKey)}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("outboundCreateUrlHelp")}
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-medium">
              {t("outboundCreateSubscriptionsTitle")}
            </h4>
            <p className="text-xs text-muted-foreground">
              {t("outboundCreateSubscriptionsHelp")}
            </p>
          </div>

          {(
            [
              {
                key: "testRunsAndSessions",
                label: "outboundSubsTestRunsAndSessions",
              },
              { key: "issues", label: "outboundSubsIssues" },
              { key: "cases", label: "outboundSubsCases" },
            ] as const
          ).map(({ key, label }) => (
            <div
              key={key}
              data-testid={`webhook-outbound-subs-section-${key}`}
              className="space-y-2 rounded-md border p-3"
            >
              <div className="flex items-center justify-between">
                <h5 className="text-sm font-semibold">{t(label)}</h5>
                <button
                  type="button"
                  data-testid={`webhook-outbound-subs-select-all-${key}`}
                  className="text-xs underline"
                  onClick={() => toggleSection(key)}
                >
                  {t("outboundSubsSelectAll")}
                </button>
              </div>
              <div className="space-y-1">
                {EVENT_CATALOG[key].map((eventName) => (
                  <label
                    key={eventName}
                    className="flex items-center gap-2 text-xs"
                  >
                    <Checkbox
                      data-testid={`webhook-outbound-subs-event-${eventName}`}
                      checked={createSubscriptions.includes(eventName)}
                      onCheckedChange={() => toggleEvent(eventName)}
                    />
                    <code>{eventName}</code>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            data-testid="webhook-outbound-create-submit"
            onClick={handleCreate}
            disabled={isSubmittingCreate}
          >
            {t("outboundCreateSubmit")}
          </Button>
          <Button
            type="button"
            variant="outline"
            data-testid="webhook-outbound-create-cancel"
            onClick={() => {
              setCreating(false);
              setCreateName("");
              setCreateUrl("");
              setCreateSubscriptions(DEFAULT_PRESET);
            }}
          >
            {t("outboundCreateCancel")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  const renderRevealedSecretBox = (secret: string, onDismiss: () => void) => (
    <div
      className="space-y-3 rounded-md border border-primary/40 bg-muted/30 p-3"
      data-testid="webhook-outbound-revealed-secret-box"
    >
      <div className="space-y-1">
        <div className="text-xs font-medium text-muted-foreground">
          {t("secret")}
        </div>
        <div className="flex items-center gap-2">
          <code
            data-testid="webhook-outbound-revealed-secret"
            className="flex-1 break-all text-xs"
          >
            {secret}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="webhook-outbound-secret-copy"
            onClick={() => copy(secret, t("secretCopied"))}
          >
            {t("outboundSecretCopy")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("outboundSecretShownOnce")}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="webhook-outbound-secret-done"
        onClick={onDismiss}
      >
        {t("outboundSecretDone")}
      </Button>
    </div>
  );

  const renderConfigCard = (config: OutboundConfig) => {
    const isSlack = config.adapterType === "SLACK";
    const activeSecret = config.secrets?.find(
      (s) => s.retiredAt === null && s.autoRetireAt === null
    );
    const retiringSecret = config.secrets?.find(
      (s) => s.retiredAt === null && s.autoRetireAt !== null
    );
    const testResult = testResults[config.id];

    return (
      <Card key={config.id} data-testid={`webhook-outbound-card-${config.id}`}>
        <CardHeader>
          <CardTitle data-testid={`webhook-outbound-card-title-${config.id}`}>
            {config.name ?? t("outboundUnnamedConfig")}
          </CardTitle>
          <CardDescription>
            <Badge>{config.adapterType}</Badge>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">
              {t("outboundUrlLabel")}
            </div>
            <code
              data-testid={`webhook-outbound-url-${config.id}`}
              className="block break-all text-xs"
            >
              {config.url ?? ""}
            </code>
            {isSlack && (
              <p className="text-xs text-muted-foreground">
                {t("outboundSlackHint")}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={config.isActive}
              onCheckedChange={(next: boolean) =>
                handleToggleActive(config.id, next)
              }
              aria-label={t("outboundActiveToggle")}
              data-testid={`webhook-outbound-active-toggle-${config.id}`}
            />
            <span className="text-sm">{t("outboundActiveToggle")}</span>
          </div>

          {!isSlack && (
            <div
              data-testid={`webhook-outbound-secrets-section-${config.id}`}
              className="space-y-2 rounded-md border p-3"
            >
              <h4 className="text-sm font-semibold">
                {t("outboundHmacSecretsTitle")}
              </h4>
              {activeSecret && (
                <div className="text-xs">
                  <Badge>{t("outboundHmacActiveSecret")}</Badge>
                </div>
              )}
              {retiringSecret && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge>{t("outboundHmacRetiringSecret")}</Badge>
                  {retiringSecret.autoRetireAt && (
                    <span>
                      {t("outboundHmacAutoRetireIn", {
                        days: Math.max(
                          0,
                          Math.ceil(
                            (new Date(retiringSecret.autoRetireAt).getTime() -
                              Date.now()) /
                              (1000 * 60 * 60 * 24)
                          )
                        ),
                      })}
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid={`webhook-outbound-extend-button-${retiringSecret.id}`}
                    onClick={() => handleExtend(retiringSecret.id)}
                  >
                    {t("outboundHmacExtendButton")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid={`webhook-outbound-retire-now-button-${retiringSecret.id}`}
                    onClick={() => setRetireDialogSecretId(retiringSecret.id)}
                  >
                    {t("outboundHmacRetireNowButton")}
                  </Button>
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid={`webhook-outbound-rotate-button-${config.id}`}
                onClick={() => setRotateDialogConfigId(config.id)}
              >
                {t("outboundHmacRotateButton")}
              </Button>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              data-testid={`webhook-outbound-send-test-button-${config.id}`}
              onClick={() => handleSendTest(config.id)}
            >
              {t("outboundSendTestButton")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              data-testid={`webhook-outbound-delete-button-${config.id}`}
              onClick={() => setDeleteDialogConfigId(config.id)}
            >
              {t("outboundDeleteButton")}
            </Button>
          </div>

          {testResult && (
            <div
              data-testid={`webhook-outbound-test-result-${config.id}`}
              className="text-xs rounded-md border px-2 py-1"
            >
              {testResult.ok
                ? t("outboundSendTestQueued")
                : t("outboundSendTestError")}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4" data-testid="webhook-outbound-form">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        {!creating && (
          <Button
            type="button"
            data-testid="webhook-outbound-add-button"
            onClick={() => setCreating(true)}
          >
            {t("outboundAddButton")}
          </Button>
        )}
      </div>

      {revealedSecret &&
        renderRevealedSecretBox(revealedSecret, () => setRevealedSecret(null))}

      {postRotateSecret &&
        renderRevealedSecretBox(postRotateSecret, () =>
          setPostRotateSecret(null)
        )}

      {creating && renderCreateForm()}

      {configs.length === 0 && !creating ? (
        <div
          data-testid="webhook-outbound-empty"
          className="rounded-md border p-6 text-center text-sm text-muted-foreground"
        >
          {t("outboundEmpty")}
        </div>
      ) : (
        <div className="space-y-4">{configs.map(renderConfigCard)}</div>
      )}

      <AlertDialog
        open={rotateDialogConfigId !== null}
        onOpenChange={(open) => !open && setRotateDialogConfigId(null)}
      >
        <AlertDialogContent data-testid="webhook-outbound-rotate-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("outboundRotateConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("outboundRotateConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="webhook-outbound-rotate-dialog-cancel">
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="webhook-outbound-rotate-dialog-confirm"
              onClick={() => {
                if (rotateDialogConfigId) handleRotate(rotateDialogConfigId);
              }}
            >
              {t("outboundHmacRotateButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteDialogConfigId !== null}
        onOpenChange={(open) => !open && setDeleteDialogConfigId(null)}
      >
        <AlertDialogContent data-testid="webhook-outbound-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("outboundDeleteConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("outboundDeleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="webhook-outbound-delete-dialog-cancel">
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="webhook-outbound-delete-dialog-confirm"
              onClick={() => {
                if (deleteDialogConfigId) handleDelete(deleteDialogConfigId);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tActions("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={retireDialogSecretId !== null}
        onOpenChange={(open) => !open && setRetireDialogSecretId(null)}
      >
        <AlertDialogContent data-testid="webhook-outbound-retire-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("outboundRetireConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("outboundRetireConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="webhook-outbound-retire-dialog-cancel">
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="webhook-outbound-retire-dialog-confirm"
              onClick={() => {
                if (retireDialogSecretId) handleRetireNow(retireDialogSecretId);
              }}
            >
              {t("outboundHmacRetireNowButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
