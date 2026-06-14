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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
  Asterisk,
  Check,
  CirclePlus,
  Copy,
  Inbox,
  Power,
  RotateCw,
  Send,
  Trash2,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { dateFnsLocaleFor } from "~/lib/utils/dateFnsLocale";
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
import {
  useFindFirstProjectIntegration,
  useFindManyWebhookConfig,
} from "~/lib/hooks";
import { Link } from "~/lib/navigation";
import { redactWebhookUrl } from "~/lib/webhooks/redaction";

interface WebhookConfigFormProps {
  projectId: number;
}

type InboundAdapterType =
  | "JIRA"
  | "GITHUB"
  | "AZURE_DEVOPS"
  | "GITLAB"
  | "GITEA"
  | "REDMINE"
  | "MANTISBT";

// Inbound webhooks today are 1:1 with the project's active issue integration:
// the only inbound consumer is `applyInboundIssueUpdate`, and a project has
// at most one active issue integration. Map the integration provider to the
// matching inbound adapter; returns null when no supported inbound adapter
// exists for the provider (e.g. SIMPLE_URL — link-only, no webhook surface).
function inboundAdapterForProvider(
  provider: string | null | undefined
): InboundAdapterType | null {
  if (provider === "JIRA") return "JIRA";
  if (provider === "GITHUB") return "GITHUB";
  if (provider === "AZURE_DEVOPS") return "AZURE_DEVOPS";
  if (provider === "GITLAB") return "GITLAB";
  if (provider === "GITEA") return "GITEA";
  if (provider === "REDMINE") return "REDMINE";
  if (provider === "MANTISBT") return "MANTISBT";
  return null;
}

type EndpointHealth = "HEALTHY" | "DEGRADED" | "DISABLED";

interface InboundConfig {
  id: string;
  projectId: number;
  adapterType: InboundAdapterType;
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
}

interface RevealedSecret {
  configId: string;
  url: string;
  // ADO's create flow does NOT return a server-minted secret (admin typed
  // the username + password themselves — D-09). The reveal box still
  // renders so the admin can copy the FULL URL once before reload, but
  // the secret field is suppressed when null. JIRA / GITHUB always carry
  // a freshly minted plaintext secret here.
  secret: string | null;
}

interface TestResultDisplay {
  ok: boolean;
  statusCode: number;
  outcome?: SendTestWebhookResult["outcome"];
  error?: string;
}

const ADAPTER_OPTIONS: ReadonlyArray<{
  value: InboundAdapterType;
  labelKey:
    | "inboundChooserJira"
    | "inboundChooserGithub"
    | "inboundChooserAdo"
    | "inboundChooserGitlab"
    | "inboundChooserGitea"
    | "inboundChooserRedmine"
    | "inboundChooserMantisbt";
  testid: string;
}> = [
  {
    value: "JIRA",
    labelKey: "inboundChooserJira",
    testid: "webhook-inbound-chooser-jira",
  },
  {
    value: "GITHUB",
    labelKey: "inboundChooserGithub",
    testid: "webhook-inbound-chooser-github",
  },
  {
    value: "AZURE_DEVOPS",
    labelKey: "inboundChooserAdo",
    testid: "webhook-inbound-chooser-ado",
  },
  {
    value: "GITLAB",
    labelKey: "inboundChooserGitlab",
    testid: "webhook-inbound-chooser-gitlab",
  },
  {
    value: "GITEA",
    labelKey: "inboundChooserGitea",
    testid: "webhook-inbound-chooser-gitea",
  },
  {
    value: "REDMINE",
    labelKey: "inboundChooserRedmine",
    testid: "webhook-inbound-chooser-redmine",
  },
  {
    value: "MANTISBT",
    labelKey: "inboundChooserMantisbt",
    testid: "webhook-inbound-chooser-mantisbt",
  },
];

function adapterSlug(
  adapterType: InboundAdapterType
): "jira" | "github" | "ado" | "gitlab" | "gitea" | "redmine" | "mantisbt" {
  if (adapterType === "JIRA") return "jira";
  if (adapterType === "GITHUB") return "github";
  if (adapterType === "GITLAB") return "gitlab";
  if (adapterType === "GITEA") return "gitea";
  if (adapterType === "REDMINE") return "redmine";
  if (adapterType === "MANTISBT") return "mantisbt";
  return "ado";
}

function adapterTitleKey(
  adapterType: InboundAdapterType
):
  | "inboundJiraTitle"
  | "inboundGithubTitle"
  | "inboundAdoTitle"
  | "inboundGitlabTitle"
  | "inboundGiteaTitle"
  | "inboundRedmineTitle"
  | "inboundMantisbtTitle" {
  if (adapterType === "JIRA") return "inboundJiraTitle";
  if (adapterType === "GITHUB") return "inboundGithubTitle";
  if (adapterType === "GITLAB") return "inboundGitlabTitle";
  if (adapterType === "GITEA") return "inboundGiteaTitle";
  if (adapterType === "REDMINE") return "inboundRedmineTitle";
  if (adapterType === "MANTISBT") return "inboundMantisbtTitle";
  return "inboundAdoTitle";
}

// D-13: shadcn Badge variant per endpoint health.
function healthBadgeVariant(
  health: EndpointHealth
): "default" | "secondary" | "destructive" {
  if (health === "DEGRADED") return "secondary";
  if (health === "DISABLED") return "destructive";
  return "default";
}

/**
 * Project admin form for INBOUND webhook configs
 *
 * Multi-card layout: one Card per `WebhookConfig` row where direction is
 * INBOUND. Add-button opens an adapter chooser (Jira / GitHub / Azure DevOps);
 * the schema's `@@unique([projectId, adapterType, direction])` constraint
 * enforces one config per adapter per project, surfaced in the UI as
 * "Already configured" disabled radio options.
 *
 * HI-01: the read `select` clause excludes the encrypted `secret` column —
 * post-create / post-rotate plaintext only ever reaches the browser via the
 * server-action return value, held in `revealed` state until dismissed.
 *
 * Per-card scoping uses `data-testid="webhook-inbound-card-{slug}"` on the
 * Card root; inner action testids are stable across all cards
 * (webhook-url, webhook-secret, webhook-send-test-button, webhook-test-result,
 * webhook-rotate-button, webhook-delete-button) so E2E spec keeps
 * passing without modification.
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

  const { data, isLoading, refetch } = useFindManyWebhookConfig({
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
    },
  });

  const configs = (data ?? []) as InboundConfig[];
  const usedAdapters = new Set<InboundAdapterType>(
    configs.map((c) => c.adapterType)
  );

  // The project's active issue integration drives which inbound adapter
  // can be added. `null` here means either no active integration exists
  // OR the active integration's provider isn't a supported inbound
  // adapter (e.g. SIMPLE_URL — link-only, no webhook surface).
  const { data: activeIntegration } = useFindFirstProjectIntegration({
    where: {
      projectId,
      isActive: true,
      integration: { isDeleted: false },
    },
    select: {
      integration: { select: { id: true, provider: true } },
    },
  });
  const activeProvider = activeIntegration?.integration?.provider ?? null;
  const adapterFromIntegration = inboundAdapterForProvider(activeProvider);
  const inboundExistsForActiveAdapter =
    adapterFromIntegration !== null && usedAdapters.has(adapterFromIntegration);
  const integrationsAdminHref = `/projects/settings/${projectId}/integrations`;

  // ─── Chooser + create form state ─────────────────────────────────────
  const [chooserOpen, setChooserOpen] = useState(false);
  const [chosenAdapter, setChosenAdapter] = useState<InboundAdapterType | null>(
    null
  );
  const [adoUsername, setAdoUsername] = useState("");
  const [adoPassword, setAdoPassword] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [revealed, setRevealed] = useState<RevealedSecret | null>(null);

  // ─── Per-card local state ────────────────────────────────────────────
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

  function resetCreateState() {
    setChooserOpen(false);
    setChosenAdapter(null);
    setAdoUsername("");
    setAdoPassword("");
  }

  // Skip the chooser step — inbound adapters are 1:1 with the project's
  // active issue integration. The chooser surface is preserved for
  // future non-issue-tracker inbound adapters.
  function startAddInboundFlow() {
    if (!adapterFromIntegration) return;
    if (adapterFromIntegration === "AZURE_DEVOPS") {
      // ADO needs the admin to type credentials before we can call the
      // server action — render the inline credentials form.
      setChooserOpen(false);
      setChosenAdapter("AZURE_DEVOPS");
      return;
    }
    // Jira/GitHub: no further input needed. Don't set chosenAdapter
    // (which would briefly render the create form before resetCreateState
    // clears it post-success — visible flash). Pass the adapter
    // explicitly since React batches state updates.
    void handleCreate(adapterFromIntegration);
  }

  async function handleCreate(adapterOverride?: InboundAdapterType) {
    const adapter = adapterOverride ?? chosenAdapter;
    if (!adapter) return;
    setIsCreating(true);
    try {
      const input: Parameters<typeof createOrRotateInboundWebhook>[0] =
        adapter === "AZURE_DEVOPS"
          ? {
              projectId,
              adapterType: "AZURE_DEVOPS",
              secretInput: {
                kind: "AZURE_DEVOPS",
                username: adoUsername,
                password: adoPassword,
              },
            }
          : { projectId, adapterType: adapter };
      const result = await createOrRotateInboundWebhook(input);
      if (!result.success) {
        toast.error(result.error ?? t("saveError"));
        return;
      }
      // M-05: the reveal box must render whenever the server returns a
      // fresh URL + configId. JIRA + GITHUB additionally return a
      // server-minted plaintext secret (HMAC); ADO returns no secret
      // because the admin already typed the credentials, but the URL
      // (with the full whk_<64-hex> token) MUST still be shown ONCE so
      // the admin can paste it into the ADO Service Hook config before
      // reload swaps in the redacted view.
      if (result.url && result.configId) {
        setRevealed({
          configId: result.configId,
          url: result.url,
          secret: result.secret ?? null,
        });
      }
      resetCreateState();
      await refetch();
    } finally {
      setIsCreating(false);
    }
  }

  async function performRotate(config: InboundConfig) {
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

  async function performDelete(config: InboundConfig) {
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
      // Clear any revealed secret tied to this config
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

  async function performReEnable(config: InboundConfig) {
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

  async function handleToggleActive(config: InboundConfig, next: boolean) {
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

  async function handleSendTest(config: InboundConfig) {
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

  function renderChooser() {
    return (
      <Card data-testid="webhook-inbound-chooser">
        <CardHeader>
          <CardTitle>{t("inboundChooserTitle")}</CardTitle>
          <CardDescription>{t("inboundChooserDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup
            value={chosenAdapter ?? undefined}
            onValueChange={(v: string) =>
              setChosenAdapter(v as InboundAdapterType)
            }
          >
            {ADAPTER_OPTIONS.map((opt) => {
              const used = usedAdapters.has(opt.value);
              return (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 text-sm"
                >
                  <RadioGroupItem
                    value={opt.value}
                    disabled={used}
                    data-testid={opt.testid}
                  />
                  <span>{t(opt.labelKey)}</span>
                  {used && (
                    <span className="text-xs text-muted-foreground">
                      {t("inboundChooserAlreadyConfigured")}
                    </span>
                  )}
                </label>
              );
            })}
          </RadioGroup>

          <div className="flex gap-2">
            <Button
              type="button"
              data-testid="webhook-inbound-chooser-submit"
              onClick={() => {
                if (!chosenAdapter) return;
                if (chosenAdapter === "AZURE_DEVOPS") {
                  setChooserOpen(false);
                } else {
                  void handleCreate();
                }
              }}
              disabled={!chosenAdapter || isCreating}
            >
              {chosenAdapter === "AZURE_DEVOPS"
                ? t("inboundChooserSubmit")
                : t("createButton")}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="webhook-inbound-chooser-cancel"
              onClick={resetCreateState}
            >
              {t("inboundChooserCancel")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  function renderCreateForm() {
    if (!chosenAdapter) return null;
    const titleKey = adapterTitleKey(chosenAdapter);
    return (
      <Card
        data-testid={`webhook-inbound-create-form-${adapterSlug(chosenAdapter)}`}
      >
        <CardHeader>
          <div className="flex items-center gap-3">
            <WebhookAdapterIcon adapterType={chosenAdapter} />
            <div className="min-w-0 flex-1">
              <CardTitle>{t(titleKey)}</CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {chosenAdapter === "AZURE_DEVOPS" && (
            <>
              <p className="text-xs text-muted-foreground">
                {t.rich("inboundAdoScopeHint", {
                  code: (chunks) => (
                    <code className="rounded bg-muted px-1 font-mono text-[0.95em]">
                      {chunks}
                    </code>
                  ),
                })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("inboundAdoResourceDetailsHint")}
              </p>
              <div className="space-y-1">
                <Label htmlFor="webhook-inbound-ado-username-input">
                  {t("inboundAdoUsername")}
                  <sup>
                    <Asterisk className="inline h-3 w-3 text-destructive" />
                  </sup>
                </Label>
                <Input
                  id="webhook-inbound-ado-username-input"
                  data-testid="webhook-inbound-ado-username-input"
                  value={adoUsername}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setAdoUsername(e.target.value)
                  }
                  placeholder={t("inboundAdoUsernamePlaceholder")}
                />
                <p className="text-xs text-muted-foreground">
                  {t("inboundAdoUsernameHelp")}
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="webhook-inbound-ado-password-input">
                  {t("inboundAdoPassword")}
                  <sup>
                    <Asterisk className="inline h-3 w-3 text-destructive" />
                  </sup>
                </Label>
                <Input
                  id="webhook-inbound-ado-password-input"
                  data-testid="webhook-inbound-ado-password-input"
                  type="password"
                  value={adoPassword}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setAdoPassword(e.target.value)
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {t("inboundAdoPasswordHelp")}
                </p>
              </div>
            </>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              data-testid="webhook-create-button"
              onClick={() => handleCreate()}
              disabled={
                isCreating ||
                (chosenAdapter === "AZURE_DEVOPS" &&
                  (adoUsername.length === 0 || adoPassword.length === 0))
              }
            >
              {t("createButton")}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="webhook-inbound-create-cancel"
              onClick={resetCreateState}
            >
              {t("inboundChooserCancel")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  function renderSetupSteps(adapterType: InboundAdapterType) {
    const stepKeys: Record<InboundAdapterType, string[]> = {
      JIRA: [
        "setupStepsJiraStep1",
        "setupStepsJiraStep2",
        "setupStepsJiraStep3",
        "setupStepsJiraStep4",
      ],
      GITHUB: [
        "setupStepsGithubStep1",
        "setupStepsGithubStep2",
        "setupStepsGithubStep3",
        "setupStepsGithubStep4",
        "setupStepsGithubStep5",
      ],
      AZURE_DEVOPS: [
        "setupStepsAdoStep1",
        "setupStepsAdoStep2",
        "setupStepsAdoStep3",
        "setupStepsAdoStep4",
        "setupStepsAdoStep5",
      ],
      GITLAB: [
        "setupStepsGitlabStep1",
        "setupStepsGitlabStep2",
        "setupStepsGitlabStep3",
        "setupStepsGitlabStep4",
      ],
      GITEA: [
        "setupStepsGiteaStep1",
        "setupStepsGiteaStep2",
        "setupStepsGiteaStep3",
        "setupStepsGiteaStep4",
        "setupStepsGiteaStep5",
      ],
      REDMINE: [
        "setupStepsRedmineStep1",
        "setupStepsRedmineStep2",
        "setupStepsRedmineStep3",
        "setupStepsRedmineStep4",
      ],
      MANTISBT: [
        "setupStepsMantisbtStep1",
        "setupStepsMantisbtStep2",
        "setupStepsMantisbtStep3",
        "setupStepsMantisbtStep4",
      ],
    };
    return (
      <div
        className="space-y-1"
        data-testid={`webhook-inbound-setup-steps-${adapterType.toLowerCase().replace("_", "-")}`}
      >
        <div className="text-xs font-medium">{t("setupStepsTitle")}</div>
        <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
          {stepKeys[adapterType].map((k) => (
            <li key={k}>{t(k as any)}</li>
          ))}
        </ol>
      </div>
    );
  }

  function renderRevealedBox(
    rev: RevealedSecret,
    adapterType: InboundAdapterType
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
      | "activityLastDispatched"
      | "activityLastSuccess"
      | "activityLastFailure",
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
            : t("activityNever")}
        </span>
      </div>
    );
  }

  function renderHealthTooltip(config: InboundConfig): string {
    if (config.endpointHealth === "DEGRADED") {
      return t("healthTooltipDegraded", {
        count: config.consecutiveFailureCount,
        lastFailureAt: config.lastFailureAt
          ? new Date(config.lastFailureAt).toISOString()
          : t("activityNever"),
      });
    }
    if (config.endpointHealth === "DISABLED") {
      return t("healthTooltipDisabled", {
        lastFailureAt: config.lastFailureAt
          ? new Date(config.lastFailureAt).toISOString()
          : t("activityNever"),
      });
    }
    return t("healthTooltipHealthy", {
      lastSuccessAt: config.lastSuccessAt
        ? new Date(config.lastSuccessAt).toISOString()
        : t("activityNever"),
    });
  }

  function renderConfigCard(config: InboundConfig) {
    const slug = adapterSlug(config.adapterType);
    const isHmacAdapter =
      config.adapterType === "JIRA" ||
      config.adapterType === "GITHUB" ||
      config.adapterType === "GITLAB" ||
      config.adapterType === "GITEA";
    const titleKey = adapterTitleKey(config.adapterType);
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
              <CardTitle>{t(titleKey)}</CardTitle>
              <CardDescription className="mt-1 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-xs">
                  <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{t("directionInbound")}</span>
                </span>
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {t("isActive")}
                </span>
                <Switch
                  checked={config.isActive}
                  onCheckedChange={(next: boolean) =>
                    void handleToggleActive(config, next)
                  }
                  aria-label={t("isActive")}
                />
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
          {config.adapterType === "GITHUB" && (
            <p className="text-xs text-muted-foreground">
              {t.rich("inboundGithubScopeHint", {
                code: (chunks) => (
                  <code className="rounded bg-muted px-1 font-mono text-[0.95em]">
                    {chunks}
                  </code>
                ),
              })}
            </p>
          )}
          {config.adapterType === "AZURE_DEVOPS" && (
            <p className="text-xs text-muted-foreground">
              {t.rich("inboundAdoScopeHint", {
                code: (chunks) => (
                  <code className="rounded bg-muted px-1 font-mono text-[0.95em]">
                    {chunks}
                  </code>
                ),
              })}
            </p>
          )}
          {config.adapterType === "GITLAB" && (
            <p className="text-xs text-muted-foreground">
              {t.rich("inboundGitlabScopeHint", {
                code: (chunks) => (
                  <code className="rounded bg-muted px-1 font-mono text-[0.95em]">
                    {chunks}
                  </code>
                ),
              })}
            </p>
          )}
          {config.adapterType === "GITEA" && (
            <p className="text-xs text-muted-foreground">
              {t.rich("inboundGiteaScopeHint", {
                code: (chunks) => (
                  <code className="rounded bg-muted px-1 font-mono text-[0.95em]">
                    {chunks}
                  </code>
                ),
              })}
            </p>
          )}
          {config.adapterType === "REDMINE" && (
            <p className="text-xs text-muted-foreground">
              {t("inboundRedmineScopeHint")}
            </p>
          )}
          {config.adapterType === "MANTISBT" && (
            <p className="text-xs text-muted-foreground">
              {t("inboundMantisbtScopeHint")}
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
            {isHmacAdapter && (
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
            <div className="ml-auto flex flex-wrap gap-2">
              <Button
                type="button"
                variant="destructive"
                data-testid="webhook-delete-button"
                onClick={() => setDeleteDialogConfigId(config.id)}
              >
                <Trash2 className="h-4 w-4" />
                <span>{tActions("delete")}</span>
              </Button>
              {isRevealedHere && (
                <Button
                  type="button"
                  data-testid="webhook-reveal-done-button"
                  onClick={() => setRevealed(null)}
                >
                  <Check className="h-4 w-4" />
                  <span>{t("revealDone")}</span>
                </Button>
              )}
            </div>
          </div>

          {renderTestResult(config.id)}
        </CardContent>
      </Card>
    );
  }

  // ─── Top-level layout ────────────────────────────────────────────────

  const inCreateFlow = chooserOpen || chosenAdapter !== null;
  const rotateConfig = configs.find((c) => c.id === rotateDialogConfigId);
  const deleteConfig = configs.find((c) => c.id === deleteDialogConfigId);
  const reenableConfig = configs.find((c) => c.id === reenableDialogConfigId);

  // Add-button gating: disabled when the project has no supported issue
  // integration to map an inbound adapter to, or when the integration's
  // adapter is already configured (1:1 model — only one inbound adapter
  // per project's active integration).
  const addButtonDisabledReason: "no-integration" | "all-configured" | null =
    !adapterFromIntegration
      ? "no-integration"
      : inboundExistsForActiveAdapter
        ? "all-configured"
        : null;

  return (
    <div className="space-y-4" data-testid="webhook-config-form">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t("inboundDescription")}
        </p>
        {!inCreateFlow &&
          (addButtonDisabledReason !== null ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    type="button"
                    data-testid="webhook-inbound-add-button"
                    disabled
                  >
                    <CirclePlus className="h-4 w-4" />
                    <span>{t("inboundAddButton")}</span>
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {addButtonDisabledReason === "no-integration"
                  ? t("inboundAddButtonNoIntegration")
                  : t("inboundAddButtonAllConfigured")}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button
              type="button"
              data-testid="webhook-inbound-add-button"
              onClick={startAddInboundFlow}
            >
              <CirclePlus className="h-4 w-4" />
              <span>{t("inboundAddButton")}</span>
            </Button>
          ))}
      </div>

      {chooserOpen && renderChooser()}
      {!chooserOpen && chosenAdapter !== null && renderCreateForm()}

      {configs.length === 0 && !inCreateFlow ? (
        <div
          data-testid="webhook-inbound-empty"
          className="rounded-md border p-6 text-center text-sm text-muted-foreground"
        >
          {adapterFromIntegration
            ? t.rich("inboundEmptyWithIntegration", {
                link: (chunks) => (
                  <button
                    type="button"
                    data-testid="webhook-inbound-empty-add-link"
                    onClick={startAddInboundFlow}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    {chunks}
                  </button>
                ),
              })
            : t.rich("inboundEmptyNoIntegration", {
                link: (chunks) => (
                  <Link
                    href={integrationsAdminHref}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    {chunks}
                  </Link>
                ),
              })}
        </div>
      ) : (
        <div className="space-y-4">{configs.map(renderConfigCard)}</div>
      )}

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
