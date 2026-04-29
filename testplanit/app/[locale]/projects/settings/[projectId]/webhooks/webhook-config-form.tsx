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
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import {
  type SendTestWebhookResult,
  createOrRotateInboundWebhook,
  deleteInboundWebhook,
  sendTestWebhook,
  setWebhookActive,
} from "~/app/actions/webhook-config";
import { useFindManyWebhookConfig } from "~/lib/hooks";
import { redactWebhookUrl } from "~/lib/webhooks/redaction";

interface WebhookConfigFormProps {
  projectId: number;
}

type InboundAdapterType = "JIRA" | "GITHUB" | "AZURE_DEVOPS";

interface InboundConfig {
  id: string;
  projectId: number;
  adapterType: InboundAdapterType;
  direction: string;
  token: string;
  isActive: boolean;
  lastReceivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RevealedSecret {
  configId: string;
  url: string;
  secret: string;
}

interface TestResultDisplay {
  ok: boolean;
  statusCode: number;
  outcome?: SendTestWebhookResult["outcome"];
  error?: string;
}

const ADAPTER_OPTIONS: ReadonlyArray<{
  value: InboundAdapterType;
  labelKey: "inboundChooserJira" | "inboundChooserGithub" | "inboundChooserAdo";
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
];

function adapterSlug(
  adapterType: InboundAdapterType
): "jira" | "github" | "ado" {
  if (adapterType === "JIRA") return "jira";
  if (adapterType === "GITHUB") return "github";
  return "ado";
}

function adapterTitleKey(
  adapterType: InboundAdapterType
): "inboundJiraTitle" | "inboundGithubTitle" | "inboundAdoTitle" {
  if (adapterType === "JIRA") return "inboundJiraTitle";
  if (adapterType === "GITHUB") return "inboundGithubTitle";
  return "inboundAdoTitle";
}

/**
 * Project admin form for INBOUND webhook configs (Phase 3 / D-16..D-21).
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
 * webhook-rotate-button, webhook-delete-button) so Phase 1's E2E spec keeps
 * passing without modification.
 */
export function WebhookConfigForm({ projectId }: WebhookConfigFormProps) {
  const t = useTranslations("projects.settings.webhooks");
  const tActions = useTranslations("common.actions");
  const tCommon = useTranslations("common");

  const { data, isLoading, refetch } = useFindManyWebhookConfig({
    where: { projectId, direction: "INBOUND" },
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

  const configs = (data ?? []) as unknown as InboundConfig[];
  const usedAdapters = new Set<InboundAdapterType>(
    configs.map((c) => c.adapterType)
  );
  const allConfigured = ADAPTER_OPTIONS.every((opt) =>
    usedAdapters.has(opt.value)
  );

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

  async function handleCreate() {
    if (!chosenAdapter) return;
    setIsCreating(true);
    try {
      const input: Parameters<typeof createOrRotateInboundWebhook>[0] =
        chosenAdapter === "AZURE_DEVOPS"
          ? {
              projectId,
              adapterType: "AZURE_DEVOPS",
              secretInput: {
                kind: "AZURE_DEVOPS",
                username: adoUsername,
                password: adoPassword,
              },
            }
          : { projectId, adapterType: chosenAdapter };
      const result = await createOrRotateInboundWebhook(input);
      if (!result.success) {
        toast.error(result.error ?? t("saveError"));
        return;
      }
      // JIRA + GITHUB return a freshly minted secret to reveal once.
      // ADO does not (admin already typed the credentials).
      if (result.url && result.secret && result.configId) {
        setRevealed({
          configId: result.configId,
          url: result.url,
          secret: result.secret,
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

  async function handleToggleActive(config: InboundConfig, next: boolean) {
    try {
      // POSITIONAL call site (Path 2 lock — matches Phase 1 server-action
      // signature at app/actions/webhook-config.ts:405-408).
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
                // Submit advances from chooser to adapter-specific create form
                if (!chosenAdapter) return;
                setChooserOpen(false);
              }}
              disabled={!chosenAdapter}
            >
              {t("inboundChooserSubmit")}
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
          <CardTitle>{t(titleKey)}</CardTitle>
          <CardDescription>
            <Badge>{chosenAdapter}</Badge>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {chosenAdapter === "GITHUB" && (
            <p className="text-xs text-muted-foreground">
              {t("inboundGithubScopeHint")}
            </p>
          )}

          {chosenAdapter === "AZURE_DEVOPS" && (
            <>
              <p className="text-xs text-muted-foreground">
                {t("inboundAdoScopeHint")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("inboundAdoResourceDetailsHint")}
              </p>
              <div className="space-y-1">
                <Label htmlFor="webhook-inbound-ado-username-input">
                  {t("inboundAdoUsername")}
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
              onClick={handleCreate}
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
    };
    return (
      <div
        className="space-y-1"
        data-testid={`webhook-inbound-setup-steps-${adapterType.toLowerCase().replace("_", "-")}`}
      >
        <div className="text-xs font-medium">{t("setupStepsTitle")}</div>
        <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
          {stepKeys[adapterType].map((k) => (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
              {rev.secret}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => copy(rev.secret, t("secretCopied"))}
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

  function renderConfigCard(config: InboundConfig) {
    const slug = adapterSlug(config.adapterType);
    const isHmacAdapter =
      config.adapterType === "JIRA" || config.adapterType === "GITHUB";
    const titleKey = adapterTitleKey(config.adapterType);
    const isRevealedHere = revealed?.configId === config.id;
    const url = `${
      typeof window !== "undefined" ? window.location.origin : ""
    }/api/webhooks/${config.token}`;
    return (
      <Card key={config.id} data-testid={`webhook-inbound-card-${slug}`}>
        <CardHeader>
          <CardTitle>{t(titleKey)}</CardTitle>
          <CardDescription>
            <Badge>{config.adapterType}</Badge>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {config.adapterType === "GITHUB" && (
            <p className="text-xs text-muted-foreground">
              {t("inboundGithubScopeHint")}
            </p>
          )}
          {config.adapterType === "AZURE_DEVOPS" && (
            <p className="text-xs text-muted-foreground">
              {t("inboundAdoScopeHint")}
            </p>
          )}

          {isRevealedHere &&
            revealed &&
            renderRevealedBox(revealed, config.adapterType)}

          {!isRevealedHere && (
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
                {config.lastReceivedAt
                  ? t("lastReceived", {
                      timestamp: new Date(config.lastReceivedAt).toISOString(),
                    })
                  : t("lastReceivedNever")}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Switch
              checked={config.isActive}
              onCheckedChange={(next: boolean) =>
                void handleToggleActive(config, next)
              }
              aria-label={t("isActive")}
            />
            <span className="text-sm">{t("isActive")}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              data-testid="webhook-send-test-button"
              onClick={() => handleSendTest(config)}
              disabled={pendingTestConfigId === config.id}
            >
              {t("sendTest")}
            </Button>
            {isHmacAdapter && (
              <Button
                type="button"
                variant="outline"
                data-testid="webhook-rotate-button"
                onClick={() => setRotateDialogConfigId(config.id)}
              >
                {t("rotateSecret")}
              </Button>
            )}
            <Button
              type="button"
              variant="destructive"
              data-testid="webhook-delete-button"
              onClick={() => setDeleteDialogConfigId(config.id)}
            >
              {tActions("delete")}
            </Button>
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

  return (
    <div className="space-y-4" data-testid="webhook-config-form">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        {!inCreateFlow && !allConfigured && (
          <Button
            type="button"
            data-testid="webhook-inbound-add-button"
            onClick={() => {
              setChooserOpen(true);
              setChosenAdapter(null);
            }}
          >
            {t("inboundAddButton")}
          </Button>
        )}
      </div>

      {chooserOpen && renderChooser()}
      {!chooserOpen && chosenAdapter !== null && renderCreateForm()}

      {configs.length === 0 && !inCreateFlow ? (
        <div
          data-testid="webhook-inbound-empty"
          className="rounded-md border p-6 text-center text-sm text-muted-foreground"
        >
          {t("inboundEmpty")}
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
    </div>
  );
}
