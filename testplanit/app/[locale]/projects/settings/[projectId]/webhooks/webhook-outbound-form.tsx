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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WebhookAdapterIcon } from "@/components/webhooks/webhook-adapter-icon";
import { RelativeTimeTooltip } from "@/components/RelativeTimeTooltip";
import {
  AlertTriangle,
  Archive,
  Asterisk,
  Check,
  CirclePlus,
  Clock,
  Copy,
  Power,
  RotateCw,
  Send,
  Trash2,
} from "lucide-react";

import { dateFnsLocaleFor } from "~/lib/utils/dateFnsLocale";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import {
  createOutboundWebhook,
  deleteOutboundWebhook,
  extendRetiringSecret,
  reEnableWebhookConfig,
  retireOutboundSecretNow,
  rotateOutboundSecret,
  sendTestOutboundWebhook,
  setWebhookActive,
  updateOutboundSubscriptions,
} from "~/app/actions/webhook-config";
import { translateServerError } from "~/lib/i18n/translateServerError";
import { isSlackWebhookUrl } from "~/lib/webhooks/slack-url-detection";
import { z } from "zod/v4";

const outboundCreateSchema = z.object({
  name: z.string().trim().min(1, "outboundCreateNameRequired"),
  url: z
    .string()
    .trim()
    .min(1, "outboundCreateUrlRequired")
    .url("outboundCreateUrlInvalid"),
});

type OutboundCreateErrors = Partial<Record<"name" | "url", string>>;

interface WebhookOutboundFormProps {
  projectId: number;
  /**
   * "project" (default) — render the project event catalog (testRuns,
   * sessions, issues, cases).
   * "system" — render the system event catalog (scim.user.*, scim.group.*).
   * Used when the form mounts under /admin/webhooks with
   * projectId = SYSTEM_PROJECT_ID.
   */
  scope?: "project" | "system";
}

/**
 * Project-scope event catalog. The UI groups events under section headers,
 * with a per-section "Select all" toggle.
 *
 * Reserved verbs: created, updated, deleted, state_changed, completed,
 * duplicated, result_added.
 */
const PROJECT_EVENT_CATALOG = {
  testRuns: [
    "test_run.created",
    "test_run.state_changed",
    "test_run.completed",
    "test_run.duplicated",
    "test_run.result_added",
    // Opt-in per webhook config — existing configs do NOT auto-subscribe.
    // Appended last so existing form-test selectors that index by
    // position are unaffected.
    "iteration.result.recorded",
    "test_run.review_requested",
    "test_run.review_completed",
  ],
  sessions: [
    "session.created",
    "session.state_changed",
    "session.completed",
    "session.duplicated",
    "session.result_added",
    "session.review_requested",
    "session.review_completed",
  ],
  issues: ["issue.created", "issue.updated", "issue.deleted"],
  cases: [
    "case.created",
    "case.updated",
    "case.deleted",
    "case.review_requested",
    "case.review_completed",
  ],
} as const;

const PROJECT_SECTION_LIST = [
  { key: "cases", label: "outboundSubsCases" },
  { key: "issues", label: "outboundSubsIssues" },
  { key: "testRuns", label: "outboundSubsTestRuns" },
  { key: "sessions", label: "outboundSubsSessions" },
] as const;

/**
 * System-scope event catalog. Used when the form renders at /admin/webhooks
 * for system-emitted events that aren't tied to a single project — currently
 * the ten SCIM lifecycle events plus the two coalescing summary types.
 */
const SYSTEM_EVENT_CATALOG = {
  scimUsers: [
    "scim.user.created",
    "scim.user.updated",
    "scim.user.activated",
    "scim.user.deactivated",
    "scim.user.deleted",
    "scim.user.created.summary",
  ],
  scimGroups: [
    "scim.group.created",
    "scim.group.updated",
    "scim.group.member_added",
    "scim.group.member_removed",
    "scim.group.deleted",
    "scim.group.member_added.summary",
  ],
} as const;

const SYSTEM_SECTION_LIST = [
  { key: "scimUsers", label: "outboundSubsScimUsers" },
  { key: "scimGroups", label: "outboundSubsScimGroups" },
] as const;

interface CatalogShape {
  catalog: Record<string, readonly string[]>;
  sections: ReadonlyArray<{ key: string; label: string }>;
}

function getCatalogForScope(scope: "project" | "system"): CatalogShape {
  if (scope === "system") {
    return {
      catalog: SYSTEM_EVENT_CATALOG as unknown as Record<
        string,
        readonly string[]
      >,
      sections: SYSTEM_SECTION_LIST,
    };
  }
  return {
    catalog: PROJECT_EVENT_CATALOG as unknown as Record<
      string,
      readonly string[]
    >,
    sections: PROJECT_SECTION_LIST,
  };
}

const DEFAULT_PRESET: string[] = [];

/**
 * Outbound config row shape returned by `useClientQueries(schema).webhookConfig.useFindMany`. The select
 * clause INCLUDES `name` and `url` (Plan 02-01 columns; Blocker 4 fix), and
 * EXCLUDES the encrypted `secret` column (HI-01).
 */
type EndpointHealth = "HEALTHY" | "DEGRADED" | "DISABLED";

interface OutboundConfig {
  id: string;
  projectId: number;
  adapterType: string;
  direction: string;
  name: string | null;
  url: string | null;
  isActive: boolean;
  subscribedEvents: string[];
  // Plan 04-07 follow-up — health badge + Delivery activity surface.
  endpointHealth: EndpointHealth;
  consecutiveFailureCount: number;
  lastDispatchedAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  secrets?: Array<{
    id: string;
    activatedAt: Date;
    retiredAt: Date | null;
    autoRetireAt: Date | null;
  }>;
}

// D-13: shadcn Badge variant per endpoint health (mirrors inbound form helper).
function healthBadgeVariant(
  health: EndpointHealth
): "default" | "secondary" | "destructive" {
  if (health === "DEGRADED") return "secondary";
  if (health === "DISABLED") return "destructive";
  return "default";
}

function adapterLabelKey(
  adapterType: string
): "adapterLabelSlack" | "adapterLabelGenericHmac" {
  return adapterType === "SLACK"
    ? "adapterLabelSlack"
    : "adapterLabelGenericHmac";
}

// Reuse existing common.* keys where they exist; only the verbs unique to
// webhook event terminology live in the webhooks scope.
const EVENT_VERB_I18N_PATH: Record<string, string> = {
  created: "common.fields.created",
  updated: "common.updated",
  deleted: "common.status.deleted",
  completed: "common.fields.completed",
  duplicated: "projects.settings.webhooks.eventVerbs.duplicated",
  state_changed: "projects.settings.webhooks.eventVerbs.stateChanged",
  result_added: "projects.settings.webhooks.eventVerbs.resultAdded",
  // The splitter in eventVerbI18nPath() returns the substring AFTER the
  // first ".", so for "iteration.result.recorded" the lookup key is the
  // literal "result.recorded" (not just "recorded").
  "result.recorded": "projects.settings.webhooks.eventVerbs.resultRecorded",
  review_requested: "projects.settings.webhooks.eventVerbs.reviewRequested",
  review_completed: "projects.settings.webhooks.eventVerbs.reviewCompleted",
  // SCIM verbs (system scope). The splitter returns "user.created",
  // "group.member_added", etc. for "scim.user.created" and the like.
  "user.created": "projects.settings.webhooks.eventVerbs.scimUserCreated",
  "user.updated": "projects.settings.webhooks.eventVerbs.scimUserUpdated",
  "user.activated": "projects.settings.webhooks.eventVerbs.scimUserActivated",
  "user.deactivated":
    "projects.settings.webhooks.eventVerbs.scimUserDeactivated",
  "user.deleted": "projects.settings.webhooks.eventVerbs.scimUserDeleted",
  "user.created.summary":
    "projects.settings.webhooks.eventVerbs.scimUserCreatedSummary",
  "group.created": "projects.settings.webhooks.eventVerbs.scimGroupCreated",
  "group.updated": "projects.settings.webhooks.eventVerbs.scimGroupUpdated",
  "group.member_added":
    "projects.settings.webhooks.eventVerbs.scimGroupMemberAdded",
  "group.member_removed":
    "projects.settings.webhooks.eventVerbs.scimGroupMemberRemoved",
  "group.deleted": "projects.settings.webhooks.eventVerbs.scimGroupDeleted",
  "group.member_added.summary":
    "projects.settings.webhooks.eventVerbs.scimGroupMemberAddedSummary",
};

function eventVerbI18nPath(eventName: string): string {
  // "case.created" → "created"; "test_run.state_changed" → "state_changed"
  const verbPart = eventName.includes(".")
    ? eventName.slice(eventName.indexOf(".") + 1)
    : eventName;
  return EVENT_VERB_I18N_PATH[verbPart] ?? verbPart;
}

/**
 * Project admin form for OUTBOUND webhook configs
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
export function WebhookOutboundForm({
  projectId,
  scope = "project",
}: WebhookOutboundFormProps) {
  const t = useTranslations("projects.settings.webhooks");
  const tCommon = useTranslations("common");
  const tActions = useTranslations("common.actions");
  const tGlobal = useTranslations();
  const dateLocale = dateFnsLocaleFor(useLocale());

  const { catalog: scopedCatalog, sections: scopedSections } =
    getCatalogForScope(scope);

  const { data, isLoading, refetch } = useClientQueries(
    schema
  ).webhookConfig.useFindMany({
    where: { projectId, direction: "OUTBOUND" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      projectId: true,
      adapterType: true,
      direction: true,
      name: true, // Blocker 4 — admin label, used as Card title
      url: true, // Blocker 4 — destination URL (Plan 02-01 column)
      isActive: true,
      subscribedEvents: true,
      // Plan 04-07 follow-up — health badge + Delivery activity surface.
      endpointHealth: true,
      consecutiveFailureCount: true,
      lastDispatchedAt: true,
      lastSuccessAt: true,
      lastFailureAt: true,
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

  const configs = (data ?? []) as OutboundConfig[];

  // ─── Create form local state ──────────────────────────────────────────
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createErrors, setCreateErrors] = useState<OutboundCreateErrors>({});
  const [createUrl, setCreateUrl] = useState("");
  const [createSubscriptions, setCreateSubscriptions] =
    useState<string[]>(DEFAULT_PRESET);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [savedFlashes, setSavedFlashes] = useState<Set<string>>(
    () => new Set()
  );
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);

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
  const [reenableDialogConfigId, setReenableDialogConfigId] = useState<
    string | null
  >(null);
  const [postRotateSecret, setPostRotateSecret] = useState<string | null>(null);

  // ─── Send-test results per config ─────────────────────────────────────
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; eventId?: string; error?: string }>
  >({});

  // ─── Handlers ─────────────────────────────────────────────────────────

  async function handleCreate() {
    const parsed = outboundCreateSchema.safeParse({
      name: createName,
      url: createUrl,
    });
    if (!parsed.success) {
      const next: OutboundCreateErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "name" || field === "url") {
          next[field] = issue.message;
        }
      }
      setCreateErrors(next);
      return;
    }
    setCreateErrors({});
    setIsSubmittingCreate(true);
    try {
      const result = await createOutboundWebhook({
        projectId,
        name: parsed.data.name,
        url: parsed.data.url,
        subscribedEvents: createSubscriptions,
      });
      if (!result.success) {
        toast.error(
          translateServerError(tGlobal, result, t("outboundCreateError"))
        );
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
      setCreateErrors({});
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

  async function performReEnable(configId: string) {
    setReenableDialogConfigId(null);
    try {
      const result = await reEnableWebhookConfig(configId);
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

  async function handleUpdateSubscriptions(
    configId: string,
    nextEvents: string[],
    flashEventNames?: string[]
  ) {
    const result = await updateOutboundSubscriptions(configId, nextEvents);
    if (!result.success) {
      toast.error(result.error ?? t("saveError"));
      return;
    }
    if (flashEventNames && flashEventNames.length > 0) {
      const flashKeys = flashEventNames.map((e) => `${configId}:${e}`);
      setSavedFlashes((prev) => {
        const next = new Set(prev);
        for (const k of flashKeys) next.add(k);
        return next;
      });
      // Each flash key gets its own independent 1.5s timer so that toggling
      // a different event mid-window doesn't shorten the existing one.
      for (const k of flashKeys) {
        setTimeout(() => {
          setSavedFlashes((prev) => {
            if (!prev.has(k)) return prev;
            const next = new Set(prev);
            next.delete(k);
            return next;
          });
        }, 1500);
      }
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

  function toggleSection(section: string) {
    const sectionEvents = scopedCatalog[section] ?? [];
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
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="webhook-outbound-name-input">
              {t("outboundCreateName")}
              <sup>
                <Asterisk className="inline h-3 w-3 text-destructive" />
              </sup>
            </Label>
            <Input
              id="webhook-outbound-name-input"
              data-testid="webhook-outbound-name-input"
              value={createName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setCreateName(e.target.value);
                if (createErrors.name) {
                  setCreateErrors((prev) => ({ ...prev, name: undefined }));
                }
              }}
              placeholder={t("outboundCreateNamePlaceholder")}
              aria-invalid={!!createErrors.name}
              aria-describedby={
                createErrors.name
                  ? "webhook-outbound-name-error"
                  : "webhook-outbound-name-help"
              }
              className={
                createErrors.name
                  ? "border-destructive focus-visible:ring-destructive"
                  : undefined
              }
            />
            {createErrors.name ? (
              <p
                id="webhook-outbound-name-error"
                data-testid="webhook-outbound-name-error"
                className="text-xs text-destructive"
              >
                {(t as unknown as (key: string) => string)(createErrors.name)}
              </p>
            ) : (
              <p
                id="webhook-outbound-name-help"
                className="text-xs text-muted-foreground"
              >
                {t("outboundCreateNameHelp")}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="webhook-outbound-url-input">
              {t("outboundCreateUrl")}
              <sup>
                <Asterisk className="inline h-3 w-3 text-destructive" />
              </sup>
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="webhook-outbound-url-input"
                data-testid="webhook-outbound-url-input"
                value={createUrl}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setCreateUrl(e.target.value);
                  if (createErrors.url) {
                    setCreateErrors((prev) => ({ ...prev, url: undefined }));
                  }
                }}
                placeholder={t("outboundCreateUrlPlaceholder")}
                aria-invalid={!!createErrors.url}
                aria-describedby={
                  createErrors.url
                    ? "webhook-outbound-url-error"
                    : "webhook-outbound-url-help"
                }
                className={
                  createErrors.url
                    ? "border-destructive focus-visible:ring-destructive"
                    : undefined
                }
              />
              {isSlackWebhookUrl(createUrl) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      data-testid="webhook-outbound-detected-slack-icon"
                      aria-label={t("outboundDetectedSlack")}
                    >
                      <WebhookAdapterIcon adapterType="SLACK" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>{t("outboundDetectedSlack")}</TooltipContent>
                </Tooltip>
              )}
            </div>
            {createErrors.url ? (
              <p
                id="webhook-outbound-url-error"
                data-testid="webhook-outbound-url-error"
                className="text-xs text-destructive"
              >
                {(t as unknown as (key: string) => string)(createErrors.url)}
              </p>
            ) : (
              <p
                id="webhook-outbound-url-help"
                className="text-xs text-muted-foreground"
              >
                {t("outboundCreateUrlHelp")}
              </p>
            )}
          </div>
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

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {scopedSections.map(({ key, label }) => (
              <div
                key={key}
                data-testid={`webhook-outbound-subs-section-${key}`}
                className="space-y-2 rounded-md border p-3"
              >
                <div className="flex items-start justify-between">
                  <h5 className="text-sm font-semibold">{t(label as never)}</h5>
                  <button
                    type="button"
                    data-testid={`webhook-outbound-subs-select-all-${key}`}
                    className="whitespace-nowrap text-xs underline"
                    onClick={() => toggleSection(key)}
                  >
                    {tActions("selectAll")}
                  </button>
                </div>
                <div className="space-y-1">
                  {scopedCatalog[key].map((eventName) => (
                    <label
                      key={eventName}
                      className="flex items-center gap-2 text-xs"
                    >
                      <Checkbox
                        data-testid={`webhook-outbound-subs-event-${eventName}`}
                        checked={createSubscriptions.includes(eventName)}
                        onCheckedChange={() => toggleEvent(eventName)}
                      />
                      <span>
                        {(tGlobal as unknown as (key: string) => string)(
                          eventVerbI18nPath(eventName)
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
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
              setCreateErrors({});
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
      <div
        role="alert"
        className="flex items-start gap-2 rounded-md bg-destructive px-3 py-2 text-xs font-medium text-destructive-foreground"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{t("outboundSecretShownOnce")}</span>
      </div>
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
            <Copy className="h-4 w-4" />
            <span>{t("outboundSecretCopy")}</span>
          </Button>
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          data-testid="webhook-outbound-secret-done"
          onClick={onDismiss}
        >
          <Check className="h-4 w-4" />
          <span>{t("outboundSecretDone")}</span>
        </Button>
      </div>
    </div>
  );

  const renderActivityRow = (
    labelKey:
      "activityLastDispatched" | "activityLastSuccess" | "activityLastFailure",
    value: Date | null
  ) => (
    <div>
      <span className="font-medium">{t(labelKey)}:</span>{" "}
      {value ? (
        <RelativeTimeTooltip
          date={new Date(value)}
          dateFnsLocale={dateLocale}
          className="inline"
        />
      ) : (
        <span>{t("activityNever")}</span>
      )}
    </div>
  );

  const renderHealthTooltip = (config: OutboundConfig): string => {
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
  };

  const renderConfigCard = (config: OutboundConfig) => {
    const isSlack = config.adapterType === "SLACK";
    const activeSecret = config.secrets?.find(
      (s) => s.retiredAt === null && s.autoRetireAt === null
    );
    const retiringSecret = config.secrets?.find(
      (s) => s.retiredAt === null && s.autoRetireAt !== null
    );
    const testResult = testResults[config.id];
    const healthLabelKey: `healthBadge.${EndpointHealth}` = `healthBadge.${config.endpointHealth}`;

    return (
      <Card
        key={config.id}
        data-testid={`webhook-outbound-card-${config.id}`}
        className={
          config.isActive ? undefined : "opacity-60 transition-opacity"
        }
      >
        <CardHeader>
          <div className="flex items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <div aria-label={t(adapterLabelKey(config.adapterType))}>
                  <WebhookAdapterIcon adapterType={config.adapterType} />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {t(adapterLabelKey(config.adapterType))}
              </TooltipContent>
            </Tooltip>
            <div className="min-w-0 flex-1">
              <CardTitle
                data-testid={`webhook-outbound-card-title-${config.id}`}
              >
                {config.name ?? t("outboundUnnamedConfig")}
              </CardTitle>
              <CardDescription className="mt-1 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-xs">
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{t("directionOutbound")}</span>
                </span>
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={config.isActive}
                  onCheckedChange={(next: boolean) =>
                    void handleToggleActive(config.id, next)
                  }
                  aria-label={t("outboundActiveToggle")}
                  data-testid={`webhook-outbound-active-toggle-${config.id}`}
                />
                <span className="text-sm text-muted-foreground">
                  {t("outboundActiveToggle")}
                </span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    data-testid={`webhook-health-badge-${config.id}`}
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
          <div className={isSlack ? undefined : "grid gap-4 sm:grid-cols-2"}>
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">{t("outboundUrlLabel")}</h4>
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

            {!isSlack && (
              <div
                data-testid={`webhook-outbound-secrets-section-${config.id}`}
                className="grid gap-4 sm:grid-cols-2"
              >
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold">
                      {t("outboundHmacSecretsTitle")}
                    </h4>
                    {!activeSecret && (
                      <Badge variant="destructive">
                        {t("outboundHmacInactiveSecret")}
                      </Badge>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid={`webhook-outbound-rotate-button-${config.id}`}
                    onClick={() => setRotateDialogConfigId(config.id)}
                  >
                    <RotateCw className="h-4 w-4" />
                    <span>{t("outboundHmacRotateButton")}</span>
                  </Button>
                </div>

                {retiringSecret && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge>{t("outboundHmacRetiringSecret")}</Badge>
                      {retiringSecret.autoRetireAt && (
                        <span>
                          {t("outboundHmacAutoRetireIn", {
                            days: Math.max(
                              0,
                              Math.ceil(
                                (new Date(
                                  retiringSecret.autoRetireAt
                                ).getTime() -
                                  Date.now()) /
                                  (1000 * 60 * 60 * 24)
                              )
                            ),
                          })}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid={`webhook-outbound-extend-button-${retiringSecret.id}`}
                        onClick={() => handleExtend(retiringSecret.id)}
                      >
                        <Clock className="h-4 w-4" />
                        <span>{t("outboundHmacExtendButton")}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid={`webhook-outbound-retire-now-button-${retiringSecret.id}`}
                        onClick={() =>
                          setRetireDialogSecretId(retiringSecret.id)
                        }
                      >
                        <Archive className="h-4 w-4" />
                        <span>{t("outboundHmacRetireNowButton")}</span>
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div
            data-testid={`webhook-outbound-subs-editor-${config.id}`}
            className="space-y-3"
          >
            <h4 className="text-sm font-medium">
              {t("outboundCreateSubscriptionsTitle")}
            </h4>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {scopedSections.map(({ key, label }) => {
                const sectionEvents = scopedCatalog[key];
                const allSelected = sectionEvents.every((e) =>
                  config.subscribedEvents.includes(e)
                );
                return (
                  <div
                    key={key}
                    data-testid={`webhook-outbound-config-${config.id}-subs-section-${key}`}
                    className="space-y-2 rounded-md border p-3"
                  >
                    <div className="flex items-start justify-between">
                      <h5 className="text-sm font-semibold">
                        {t(label as never)}
                      </h5>
                      <button
                        type="button"
                        data-testid={`webhook-outbound-config-${config.id}-subs-select-all-${key}`}
                        className="whitespace-nowrap text-xs underline"
                        onClick={() => {
                          const next = allSelected
                            ? config.subscribedEvents.filter(
                                (e) =>
                                  !(
                                    sectionEvents as readonly string[]
                                  ).includes(e)
                              )
                            : Array.from(
                                new Set([
                                  ...config.subscribedEvents,
                                  ...sectionEvents,
                                ])
                              );
                          void handleUpdateSubscriptions(
                            config.id,
                            next,
                            sectionEvents.slice()
                          );
                        }}
                      >
                        {tActions("selectAll")}
                      </button>
                    </div>
                    <div className="space-y-1">
                      {sectionEvents.map((eventName) => {
                        const checked =
                          config.subscribedEvents.includes(eventName);
                        return (
                          <label
                            key={eventName}
                            className="flex items-center gap-2 text-xs"
                          >
                            <Checkbox
                              data-testid={`webhook-outbound-config-${config.id}-event-${eventName}`}
                              checked={checked}
                              onCheckedChange={() => {
                                const next = checked
                                  ? config.subscribedEvents.filter(
                                      (e) => e !== eventName
                                    )
                                  : [...config.subscribedEvents, eventName];
                                void handleUpdateSubscriptions(
                                  config.id,
                                  next,
                                  [eventName]
                                );
                              }}
                            />
                            <span>
                              {(tGlobal as unknown as (key: string) => string)(
                                eventVerbI18nPath(eventName)
                              )}
                            </span>
                            {savedFlashes.has(`${config.id}:${eventName}`) && (
                              <Check
                                className="h-3.5 w-3.5 text-success"
                                aria-hidden="true"
                              />
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div
            data-testid={`webhook-delivery-activity-${config.id}`}
            className="space-y-2 text-sm text-muted-foreground"
          >
            <h4 className="text-sm font-semibold text-foreground">
              {t("activityLabel")}
            </h4>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {renderActivityRow(
                "activityLastDispatched",
                config.lastDispatchedAt
              )}
              {renderActivityRow("activityLastSuccess", config.lastSuccessAt)}
              {renderActivityRow("activityLastFailure", config.lastFailureAt)}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              data-testid={`webhook-outbound-send-test-button-${config.id}`}
              onClick={() => handleSendTest(config.id)}
            >
              <Send className="h-4 w-4" />
              <span>{t("outboundSendTestButton")}</span>
            </Button>
            {config.endpointHealth === "DISABLED" && (
              <Button
                type="button"
                data-testid={`webhook-reenable-button-${config.id}`}
                onClick={() => setReenableDialogConfigId(config.id)}
              >
                <Power className="h-4 w-4" />
                <span>{t("reEnable")}</span>
              </Button>
            )}
            <Button
              type="button"
              variant="destructive"
              data-testid={`webhook-outbound-delete-button-${config.id}`}
              onClick={() => setDeleteDialogConfigId(config.id)}
            >
              <Trash2 className="h-4 w-4" />
              <span>{t("outboundDeleteButton")}</span>
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
        <p className="text-sm text-muted-foreground">
          {t("outboundDescription")}
        </p>
        {!creating && (
          <Button
            type="button"
            data-testid="webhook-outbound-add-button"
            onClick={() => setCreating(true)}
          >
            <CirclePlus className="h-4 w-4" />
            <span>{t("outboundAddButton")}</span>
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
                if (rotateDialogConfigId)
                  void handleRotate(rotateDialogConfigId);
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
                if (deleteDialogConfigId)
                  void handleDelete(deleteDialogConfigId);
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
                if (retireDialogSecretId)
                  void handleRetireNow(retireDialogSecretId);
              }}
            >
              {t("outboundHmacRetireNowButton")}
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
                if (reenableDialogConfigId)
                  void performReEnable(reenableDialogConfigId);
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
