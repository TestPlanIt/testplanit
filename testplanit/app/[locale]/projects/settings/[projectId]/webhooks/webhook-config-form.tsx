"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
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
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DateFormatter } from "@/components/DateFormatter";
import { WebhookAdapterIcon } from "@/components/webhooks/webhook-adapter-icon";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Check,
  CirclePlus,
  Copy,
  Inbox,
  Power,
  RotateCw,
  Send,
  Trash,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
  type SendTestWebhookResult,
  createOrRotateInboundWebhook,
  deleteInboundWebhook,
  reEnableWebhookConfig,
  sendTestWebhook,
  setWebhookActive,
} from "~/app/actions/webhook-config";
import { dateFnsLocaleFor } from "~/lib/utils/dateFnsLocale";
import { inboundAdapterForCodeRepository } from "~/lib/webhooks/codeChangeEvents";
import { redactWebhookUrl } from "~/lib/webhooks/redaction";
import {
  ISSUE_SCOPE_HINT,
  ISSUE_SETUP_STEP_KEYS,
  adapterSlug,
  adapterTitleKey,
  hasRotatableSecret,
  healthBadgeVariant,
  inboundAdapterForProvider,
  type EndpointHealth,
  type IssueInboundAdapterType,
} from "./inbound-adapters";
import {
  InboundWebhookWizard,
  type WizardRepository,
} from "./inbound-webhook-wizard";
import {
  RepositoryWebhookCard,
  type RepositoryWebhookRow,
} from "./repository-webhook-card";

interface WebhookConfigFormProps {
  projectId: number;
}

interface InboundConfig {
  id: string;
  projectId: number;
  adapterType: string;
  direction: string;
  token: string;
  isActive: boolean;
  lastReceivedAt: Date | null;
  endpointHealth: EndpointHealth;
  consecutiveFailureCount: number;
  lastDispatchedAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  subscribedEvents: string[];
  baseBranch: string | null;
  codeRepositoryConfigId: number | null;
  codeRepositoryConfig: RepositoryWebhookRow["codeRepositoryConfig"] | null;
}

interface IssueConfig extends InboundConfig {
  adapterType: IssueInboundAdapterType;
}

interface RevealedSecret {
  configId: string;
  url: string;
  /** ADO rotations return no secret: the admin typed the credentials. */
  secret: string | null;
}

interface TestResultDisplay {
  ok: boolean;
  statusCode: number;
  outcome?: SendTestWebhookResult["outcome"];
  error?: string;
}

/**
 * The Inbound tab: one Add button that opens the wizard, then one card per
 * inbound webhook — the issue-tracker webhook (at most one, matching the
 * project's active integration) and one per Impact repository connection.
 *
 * The read `select` never includes the encrypted `secret` column; a
 * plaintext secret only reaches the browser in a create or rotate result
 * and is held in `revealed` until dismissed.
 */
export function WebhookConfigForm({ projectId }: WebhookConfigFormProps) {
  const t = useTranslations("projects.settings.webhooks");
  const dateLocale = dateFnsLocaleFor(useLocale());
  const { data: session } = useSession();
  const dateTimeFormat = session?.user?.preferences?.dateFormat
    ? `${session.user.preferences.dateFormat} ${session.user.preferences.timeFormat || "HH:mm"}`
    : undefined;
  const tActions = useTranslations("common.actions");
  const tCommon = useTranslations("common");

  const { data, isLoading, refetch } = useClientQueries(
    schema
  ).webhookConfig.useFindMany({
    where: { projectId, direction: "INBOUND" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      projectId: true,
      adapterType: true,
      direction: true,
      token: true,
      isActive: true,
      lastReceivedAt: true,
      endpointHealth: true,
      consecutiveFailureCount: true,
      lastDispatchedAt: true,
      lastSuccessAt: true,
      lastFailureAt: true,
      createdAt: true,
      updatedAt: true,
      subscribedEvents: true,
      baseBranch: true,
      codeRepositoryConfigId: true,
      codeRepositoryConfig: {
        select: {
          id: true,
          branch: true,
          repository: { select: { id: true, name: true, provider: true } },
        },
      },
    },
  });

  const configs = (data ?? []) as InboundConfig[];
  const issueConfigs = configs.filter(
    (c): c is IssueConfig =>
      c.codeRepositoryConfigId == null &&
      inboundAdapterForProvider(c.adapterType) !== null
  );

  // The project's active issue integration decides which issue-tracker
  // adapter the wizard can add; null covers "no integration" and providers
  // without a webhook surface (Simple URL).
  const { data: activeIntegration } = useClientQueries(
    schema
  ).projectIntegration.useFindFirst({
    where: {
      projectId,
      isActive: true,
      integration: { isDeleted: false },
    },
    select: {
      integration: { select: { id: true, provider: true } },
    },
  });
  const issueAdapter = inboundAdapterForProvider(
    activeIntegration?.integration?.provider ?? null
  );
  const issueConfigured =
    issueAdapter !== null &&
    issueConfigs.some((c) => c.adapterType === issueAdapter);

  const { data: connectionsData } = useClientQueries(
    schema
  ).projectCodeRepositoryConfig.useFindMany({
    where: { projectId, purpose: "IMPACT" },
    orderBy: { id: "asc" },
    select: {
      id: true,
      branch: true,
      repository: { select: { id: true, name: true, provider: true } },
    },
  });
  const repositories: WizardRepository[] = (connectionsData ?? []).map(
    (connection) => ({
      id: connection.id,
      name: connection.repository.name,
      provider: connection.repository.provider,
      branch: connection.branch,
      adapterType: inboundAdapterForCodeRepository(
        connection.repository.provider
      ),
      configured: configs.some(
        (c) => c.codeRepositoryConfigId === connection.id
      ),
    })
  );

  const [wizardOpen, setWizardOpen] = useState(false);
  const [revealed, setRevealed] = useState<RevealedSecret | null>(null);
  const [rotateDialogConfigId, setRotateDialogConfigId] = useState<
    string | null
  >(null);
  const [deleteDialogConfigId, setDeleteDialogConfigId] = useState<
    string | null
  >(null);
  const [reenableDialogConfigId, setReenableDialogConfigId] = useState<
    string | null
  >(null);
  const [testResults, setTestResults] = useState<
    Record<string, TestResultDisplay>
  >({});
  const [pendingTestConfigId, setPendingTestConfigId] = useState<string | null>(
    null
  );

  if (isLoading) {
    return null;
  }

  // ─── Handlers ────────────────────────────────────────────────────────

  async function performRotate(config: IssueConfig) {
    setRotateDialogConfigId(null);
    try {
      const result = await createOrRotateInboundWebhook({
        projectId,
        adapterType: config.adapterType,
      });
      if (!result.success) {
        toast.error(result.error ?? t("saveError"));
        return;
      }
      if (result.url && result.secret && result.configId) {
        setRevealed({
          configId: result.configId,
          url: result.url,
          secret: result.secret,
        });
      }
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveError"));
    }
  }

  async function performDelete(config: IssueConfig) {
    setDeleteDialogConfigId(null);
    try {
      const result = await deleteInboundWebhook({
        webhookConfigId: config.id,
        projectId,
      });
      if (!result.success) {
        toast.error(result.error ?? t("saveError"));
        return;
      }
      setRevealed((prev) => (prev?.configId === config.id ? null : prev));
      setTestResults((prev) => {
        const { [config.id]: _drop, ...rest } = prev;
        return rest;
      });
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveError"));
    }
  }

  async function performReEnable(config: IssueConfig) {
    setReenableDialogConfigId(null);
    try {
      const result = await reEnableWebhookConfig(config.id);
      if (!result.ok) {
        toast.error(t("toastReEnableFailed", { error: result.error ?? "" }));
        return;
      }
      toast.success(t("toastReEnableSuccess"));
      await refetch();
    } catch (err) {
      toast.error(
        t("toastReEnableFailed", {
          error: err instanceof Error ? err.message : "",
        })
      );
    }
  }

  async function handleToggleActive(config: IssueConfig, next: boolean) {
    try {
      const result = await setWebhookActive(config.id, next);
      if (!result.success) {
        toast.error(result.error ?? t("saveError"));
        return;
      }
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveError"));
    }
  }

  async function handleSendTest(config: IssueConfig) {
    setPendingTestConfigId(config.id);
    try {
      const result = await sendTestWebhook(config.id);
      setTestResults((prev) => ({
        ...prev,
        [config.id]: {
          ok: result.ok,
          statusCode: result.statusCode,
          outcome: result.outcome,
          error: result.error,
        },
      }));
    } finally {
      setPendingTestConfigId(null);
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

  // ─── Renderers ───────────────────────────────────────────────────────

  function renderSetupSteps(adapterType: IssueInboundAdapterType) {
    return (
      <div
        className="space-y-1"
        data-testid={`webhook-inbound-setup-steps-${adapterType.toLowerCase().replace("_", "-")}`}
      >
        <div className="text-xs font-medium">{t("setupStepsTitle")}</div>
        <ol className="list-decimal space-y-1 ps-5 text-xs text-muted-foreground">
          {ISSUE_SETUP_STEP_KEYS[adapterType].map((k) => (
            <li key={k}>{t(k as any)}</li>
          ))}
        </ol>
      </div>
    );
  }

  function renderRevealedBox(
    rev: RevealedSecret,
    adapterType: IssueInboundAdapterType
  ) {
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
        {renderSetupSteps(adapterType)}
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
          <p className="text-xs text-muted-foreground">{t("urlHelp")}</p>
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
                onClick={() =>
                  rev.secret && copy(rev.secret, t("secretCopied"))
                }
                aria-label={t("copySecret")}
              >
                <Copy className="h-4 w-4" />
                <span>{tActions("copy")}</span>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("secretHelp")}</p>
          </div>
        )}
        <p className="text-xs text-muted-foreground border-t border-primary/20 pt-2">
          {t("nextSteps")}
        </p>
      </div>
    );
  }

  function renderTestResult(configId: string) {
    const result = testResults[configId];
    if (!result) return null;
    const message = result.ok
      ? t("testSuccess", {
          statusCode: result.statusCode,
          outcome: result.outcome ?? "",
        })
      : t("testFailure", {
          statusCode: result.statusCode,
          error: result.error ?? "",
        });
    return (
      <div
        data-testid="webhook-test-result"
        className="text-sm rounded-md border px-3 py-2"
      >
        {message}
      </div>
    );
  }

  function renderActivityRow(
    labelKey:
      "activityLastDispatched" | "activityLastSuccess" | "activityLastFailure",
    value: Date | null
  ) {
    return (
      <div>
        <span className="font-medium">{t(labelKey)}:</span>{" "}
        <span>
          {value
            ? formatDistanceToNow(new Date(value), {
                addSuffix: true,
                locale: dateLocale,
              })
            : tCommon("never")}
        </span>
      </div>
    );
  }

  function renderHealthTooltip(config: IssueConfig): string {
    if (config.endpointHealth === "DEGRADED") {
      return t("healthTooltipDegraded", {
        count: config.consecutiveFailureCount,
        lastFailureAt: config.lastFailureAt
          ? new Date(config.lastFailureAt).toISOString()
          : tCommon("never"),
      });
    }
    if (config.endpointHealth === "DISABLED") {
      return t("healthTooltipDisabled", {
        lastFailureAt: config.lastFailureAt
          ? new Date(config.lastFailureAt).toISOString()
          : tCommon("never"),
      });
    }
    return t("healthTooltipHealthy", {
      lastSuccessAt: config.lastSuccessAt
        ? new Date(config.lastSuccessAt).toISOString()
        : tCommon("never"),
    });
  }

  function renderIssueCard(config: IssueConfig) {
    const slug = adapterSlug(config.adapterType);
    const titleKey = adapterTitleKey(config.adapterType);
    const hint = ISSUE_SCOPE_HINT[config.adapterType];
    const isRevealedHere = revealed?.configId === config.id;
    const url = `${
      typeof window !== "undefined" ? window.location.origin : ""
    }/api/webhooks/${config.token}`;
    const healthLabelKey: `healthBadge.${EndpointHealth}` = `healthBadge.${config.endpointHealth}`;
    return (
      <Card
        key={config.id}
        data-testid={`webhook-inbound-card-${slug}`}
        className={
          config.isActive ? undefined : "opacity-60 transition-opacity"
        }
      >
        <CardHeader>
          <div className="flex items-center gap-3">
            <WebhookAdapterIcon adapterType={config.adapterType} />
            <div className="min-w-0 flex-1">
              <CardTitle>{t(titleKey as any)}</CardTitle>
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
                  checked={config.isActive}
                  onCheckedChange={(next: boolean) =>
                    void handleToggleActive(config, next)
                  }
                  aria-label={tCommon("fields.enabled")}
                />
                <span className="text-sm text-muted-foreground">
                  {tCommon("fields.enabled")}
                </span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    data-testid={`webhook-health-badge-${slug}`}
                    variant={healthBadgeVariant(config.endpointHealth)}
                    title={renderHealthTooltip(config)}
                  >
                    {t(healthLabelKey)}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>{renderHealthTooltip(config)}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {hint && (
            <p className="text-xs text-muted-foreground">
              {hint.rich
                ? t.rich(hint.key as any, {
                    code: (chunks) => (
                      <code className="rounded bg-muted px-1 font-mono text-[0.95em]">
                        {chunks}
                      </code>
                    ),
                  })
                : t(hint.key as any)}
            </p>
          )}

          {isRevealedHere &&
            revealed &&
            renderRevealedBox(revealed, config.adapterType)}

          {!isRevealedHere && (
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
                    {redactWebhookUrl(url)}
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
                  {config.lastReceivedAt ? (
                    <>
                      {t("lastReceivedLabel")}{" "}
                      <DateFormatter
                        date={config.lastReceivedAt}
                        formatString={dateTimeFormat}
                        timezone={session?.user?.preferences?.timezone}
                      />
                    </>
                  ) : (
                    t("lastReceivedNever")
                  )}
                </div>
              </div>

              <div
                data-testid={`webhook-delivery-activity-${slug}`}
                className="space-y-1 text-sm text-muted-foreground"
              >
                <div className="text-xs font-medium uppercase">
                  {t("activityLabel")}
                </div>
                {renderActivityRow(
                  "activityLastDispatched",
                  config.lastDispatchedAt
                )}
                {renderActivityRow("activityLastSuccess", config.lastSuccessAt)}
                {renderActivityRow("activityLastFailure", config.lastFailureAt)}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              data-testid="webhook-send-test-button"
              onClick={() => handleSendTest(config)}
              disabled={pendingTestConfigId === config.id}
            >
              <Send className="h-4 w-4" />
              <span>{t("sendTest")}</span>
            </Button>
            {hasRotatableSecret(config.adapterType) && (
              <Button
                type="button"
                variant="outline"
                data-testid="webhook-rotate-button"
                onClick={() => setRotateDialogConfigId(config.id)}
              >
                <RotateCw className="h-4 w-4" />
                <span>{t("rotateSecret")}</span>
              </Button>
            )}
            {config.endpointHealth === "DISABLED" && (
              <Button
                type="button"
                data-testid={`webhook-reenable-button-${slug}`}
                onClick={() => setReenableDialogConfigId(config.id)}
              >
                <Power className="h-4 w-4" />
                <span>{t("reEnable")}</span>
              </Button>
            )}
            <div className="ms-auto flex flex-wrap gap-2">
              <Button
                type="button"
                variant="destructive"
                data-testid="webhook-delete-button"
                onClick={() => setDeleteDialogConfigId(config.id)}
              >
                <Trash className="h-4 w-4" />
                <span>{tActions("delete")}</span>
              </Button>
              {isRevealedHere && (
                <Button
                  type="button"
                  data-testid="webhook-reveal-done-button"
                  onClick={() => setRevealed(null)}
                >
                  <Check className="h-4 w-4" />
                  <span>{tCommon("actions.done")}</span>
                </Button>
              )}
            </div>
          </div>

          {renderTestResult(config.id)}
        </CardContent>
      </Card>
    );
  }

  function renderCard(config: InboundConfig) {
    if (config.codeRepositoryConfigId != null && config.codeRepositoryConfig) {
      return (
        <RepositoryWebhookCard
          key={config.id}
          projectId={projectId}
          hook={{
            id: config.id,
            token: config.token,
            adapterType:
              config.adapterType as RepositoryWebhookRow["adapterType"],
            isActive: config.isActive,
            subscribedEvents: config.subscribedEvents,
            baseBranch: config.baseBranch ?? null,
            endpointHealth: config.endpointHealth,
            lastReceivedAt: config.lastReceivedAt,
            codeRepositoryConfig: config.codeRepositoryConfig,
          }}
          onChanged={refetch}
        />
      );
    }
    const issue = issueConfigs.find((c) => c.id === config.id);
    return issue ? renderIssueCard(issue) : null;
  }

  // ─── Top-level layout ────────────────────────────────────────────────

  const rotateConfig = issueConfigs.find((c) => c.id === rotateDialogConfigId);
  const deleteConfig = issueConfigs.find((c) => c.id === deleteDialogConfigId);
  const reenableConfig = issueConfigs.find(
    (c) => c.id === reenableDialogConfigId
  );

  return (
    <div className="space-y-4" data-testid="webhook-config-form">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {t("inboundDescription")}
        </p>
        <Button
          type="button"
          data-testid="webhook-inbound-add-button"
          onClick={() => setWizardOpen(true)}
        >
          <CirclePlus className="h-4 w-4" />
          <span>{t("inboundAddButton")}</span>
        </Button>
      </div>

      {configs.length === 0 ? (
        <div
          data-testid="webhook-inbound-empty"
          className="rounded-md border p-6 text-center text-sm text-muted-foreground"
        >
          {t.rich("inboundEmptyState", {
            link: (chunks) => (
              <button
                type="button"
                data-testid="webhook-inbound-empty-add-link"
                onClick={() => setWizardOpen(true)}
                className="underline underline-offset-2 hover:text-foreground"
              >
                {chunks}
              </button>
            ),
          })}
        </div>
      ) : (
        <div className="space-y-4">{configs.map(renderCard)}</div>
      )}

      <InboundWebhookWizard
        projectId={projectId}
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        issueAdapter={issueAdapter}
        issueConfigured={issueConfigured}
        repositories={repositories}
        onCreated={refetch}
      />

      <AlertDialog
        open={rotateDialogConfigId !== null}
        onOpenChange={(open) => !open && setRotateDialogConfigId(null)}
      >
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
              onClick={() => {
                if (rotateConfig) void performRotate(rotateConfig);
              }}
            >
              {t("rotateSecret")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteDialogConfigId !== null}
        onOpenChange={(open) => !open && setDeleteDialogConfigId(null)}
      >
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
              onClick={() => {
                if (deleteConfig) void performDelete(deleteConfig);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tActions("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={reenableDialogConfigId !== null}
        onOpenChange={(open) => !open && setReenableDialogConfigId(null)}
      >
        <AlertDialogContent data-testid="webhook-reenable-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("reEnableConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("reEnableConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="webhook-reenable-dialog-cancel">
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="webhook-reenable-dialog-confirm"
              onClick={() => {
                if (reenableConfig) void performReEnable(reenableConfig);
              }}
            >
              {t("reEnable")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
