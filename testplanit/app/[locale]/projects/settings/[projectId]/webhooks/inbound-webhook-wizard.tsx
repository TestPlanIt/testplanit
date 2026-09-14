"use client";

import { CodeRepositoryName } from "@/components/CodeRepositoryName";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { WizardStepIndicator } from "@/components/ui/WizardStepIndicator";
import { WebhookAdapterIcon } from "@/components/webhooks/webhook-adapter-icon";
import { AlertTriangle, Asterisk, Check, Copy, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
  createOrRotateCodeRepositoryWebhook,
  createOrRotateInboundWebhook,
} from "~/app/actions/webhook-config";
import { Link } from "~/lib/navigation";
import {
  CODE_EVENT_BRANCH_PUSH,
  CODE_EVENT_PULL_REQUEST,
  CODE_EVENT_PUSH,
} from "~/lib/webhooks/codeChangeEvents";
import type { AdapterType } from "~/zenstack/models";
import { cn } from "~/utils";
import {
  ISSUE_SCOPE_HINT,
  ISSUE_SETUP_STEP_KEYS,
  REPOSITORY_SETUP_KEY,
  adapterLabelKey,
  adapterTitleKey,
  type IssueInboundAdapterType,
} from "./inbound-adapters";

/** An Impact repository connection the wizard can bind a webhook to. */
export interface WizardRepository {
  id: number;
  name: string;
  provider: string;
  branch: string | null;
  /** Inbound adapter that verifies this provider; null = cannot send. */
  adapterType: AdapterType | null;
  /** Already has a webhook. */
  configured: boolean;
}

export interface InboundWebhookWizardProps {
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Adapter of the project's active issue integration; null = none. */
  issueAdapter: IssueInboundAdapterType | null;
  /** The issue-tracker webhook already exists. */
  issueConfigured: boolean;
  repositories: WizardRepository[];
  /** Called after a webhook was created, before the Connect step shows. */
  onCreated: () => Promise<unknown> | void;
}

type Source = "issues" | "repository";
type Step = 1 | 2 | 3;

interface Revealed {
  url: string;
  secret: string | null;
}

/**
 * Three steps: pick what sends the webhook, fill in what that source
 * needs, then copy the URL and secret while they are still readable. The
 * body is mounted only while the dialog is open so every run starts clean.
 */
export function InboundWebhookWizard(props: InboundWebhookWizardProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <WizardBody {...props} />}
    </Dialog>
  );
}

function WizardBody({
  projectId,
  onOpenChange,
  issueAdapter,
  issueConfigured,
  repositories,
  onCreated,
}: InboundWebhookWizardProps) {
  const t = useTranslations("projects.settings.webhooks");
  const tGlobal = useTranslations();
  const tActions = useTranslations("common.actions");
  const tCommon = useTranslations("common");

  const issuesAvailable = issueAdapter !== null && !issueConfigured;
  const availableRepositories = repositories.filter(
    (repo) => repo.adapterType !== null && !repo.configured
  );
  const repositoryAvailable = availableRepositories.length > 0;

  const [step, setStep] = useState<Step>(1);
  const [source, setSource] = useState<Source | null>(
    issuesAvailable && !repositoryAvailable
      ? "issues"
      : repositoryAvailable && !issuesAvailable
        ? "repository"
        : null
  );
  const [repositoryId, setRepositoryId] = useState<number | null>(
    availableRepositories.length === 1 ? availableRepositories[0].id : null
  );
  const [pullRequestsOn, setPullRequestsOn] = useState(true);
  const [pushesOn, setPushesOn] = useState(true);
  const [branchPushesOn, setBranchPushesOn] = useState(false);
  const [baseBranch, setBaseBranch] = useState("");
  const [adoUsername, setAdoUsername] = useState("");
  const [adoPassword, setAdoPassword] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [revealed, setRevealed] = useState<Revealed | null>(null);

  const repository =
    availableRepositories.find((repo) => repo.id === repositoryId) ?? null;
  const adapterType: AdapterType | null =
    source === "issues" ? issueAdapter : (repository?.adapterType ?? null);
  const needsCredentials = adapterType === "AZURE_DEVOPS";
  const credentialsReady =
    !needsCredentials || (adoUsername.length > 0 && adoPassword.length > 0);
  const canCreate =
    !isCreating &&
    adapterType !== null &&
    credentialsReady &&
    (source !== "repository" || repository !== null);

  const secretInput = needsCredentials
    ? ({
        kind: "AZURE_DEVOPS",
        username: adoUsername,
        password: adoPassword,
      } as const)
    : undefined;

  async function create() {
    if (!canCreate || !source) return;
    setIsCreating(true);
    try {
      const result =
        source === "issues"
          ? await createOrRotateInboundWebhook({
              projectId,
              adapterType: issueAdapter as IssueInboundAdapterType,
              ...(secretInput ? { secretInput } : {}),
            })
          : await createOrRotateCodeRepositoryWebhook({
              projectId,
              codeRepositoryConfigId: repository!.id,
              secretInput,
              subscribedEvents: [
                ...(pullRequestsOn ? [CODE_EVENT_PULL_REQUEST] : []),
                ...(pushesOn ? [CODE_EVENT_PUSH] : []),
                ...(branchPushesOn ? [CODE_EVENT_BRANCH_PUSH] : []),
              ],
              baseBranch: baseBranch.trim() || null,
            });
      if (!result.success || !result.url) {
        toast.error(result.error ?? t("saveError"));
        return;
      }
      setRevealed({ url: result.url, secret: result.secret ?? null });
      setStep(3);
      await onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saveError"));
    } finally {
      setIsCreating(false);
    }
  }

  async function copy(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(message);
    } catch {
      toast.error(tCommon("errors.error"));
    }
  }

  function renderSourceOption(
    value: Source,
    title: string,
    help: string,
    disabledReason: React.ReactNode | null
  ) {
    const disabled = disabledReason !== null;
    return (
      <label
        className={cn(
          "flex items-start gap-3 rounded-md border p-3",
          disabled ? "opacity-70" : "cursor-pointer hover:bg-muted/40",
          source === value && !disabled && "border-primary bg-muted/30"
        )}
      >
        <RadioGroupItem
          value={value}
          disabled={disabled}
          className="mt-0.5"
          data-testid={`webhook-wizard-source-${value}`}
        />
        <span className="min-w-0 space-y-1 text-sm">
          <span className="block font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">{help}</span>
          {disabled && (
            <span
              className="block text-xs text-destructive"
              data-testid={`webhook-wizard-source-${value}-reason`}
            >
              {disabledReason}
            </span>
          )}
        </span>
      </label>
    );
  }

  function renderSourceStep() {
    const issueLabelKey = issueAdapter ? adapterLabelKey(issueAdapter) : null;
    const issueReason: React.ReactNode | null = !issueAdapter
      ? t.rich("inboundEmptyNoIntegration", {
          link: (chunks) => (
            <Link
              href={`/projects/settings/${projectId}/integrations`}
              className="underline underline-offset-2"
            >
              {chunks}
            </Link>
          ),
        })
      : issueConfigured
        ? t("inboundAddButtonAllConfigured")
        : null;
    const repositoryReason: React.ReactNode | null =
      repositories.length === 0
        ? t.rich("codeRepos.empty", {
            link: (chunks) => (
              <Link
                href={`/projects/settings/${projectId}/impact`}
                className="underline underline-offset-2"
              >
                {chunks}
              </Link>
            ),
          })
        : !repositoryAvailable
          ? t("wizard.noRepositoryAvailable")
          : null;
    return (
      <RadioGroup
        value={source ?? undefined}
        onValueChange={(value: string) => setSource(value as Source)}
        className="space-y-2"
        data-testid="webhook-wizard-source"
      >
        {renderSourceOption(
          "issues",
          t("wizard.sourceIssues"),
          issueLabelKey
            ? t("wizard.sourceIssuesHelp", {
                tracker: t(issueLabelKey as any),
              })
            : t("wizard.sourceIssuesHelpGeneric"),
          issueReason
        )}
        {renderSourceOption(
          "repository",
          tGlobal("automation.settings.repository"),
          t("wizard.sourceRepositoryHelp"),
          repositoryReason
        )}
      </RadioGroup>
    );
  }

  function renderCredentials() {
    return (
      <div className="space-y-3" data-testid="webhook-wizard-credentials">
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
      </div>
    );
  }

  function renderIssueDetails(adapter: IssueInboundAdapterType) {
    const hint = ISSUE_SCOPE_HINT[adapter];
    return (
      <div className="space-y-4" data-testid="webhook-wizard-issue-details">
        <div className="flex items-center gap-3">
          <WebhookAdapterIcon adapterType={adapter} />
          <span className="font-medium">
            {t(adapterTitleKey(adapter) as any)}
          </span>
        </div>
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
        {needsCredentials && renderCredentials()}
      </div>
    );
  }

  function renderRepositoryDetails() {
    const effectiveBranch = baseBranch.trim() || repository?.branch || null;
    return (
      <div
        className="space-y-4"
        data-testid="webhook-wizard-repository-details"
      >
        <div className="space-y-1">
          <Label htmlFor="webhook-wizard-repository">
            {tCommon("pageTitles.repository")}
          </Label>
          <Select
            value={repositoryId === null ? "" : String(repositoryId)}
            onValueChange={(value) => setRepositoryId(Number(value))}
          >
            <SelectTrigger
              id="webhook-wizard-repository"
              data-testid="webhook-wizard-repository"
            >
              <SelectValue placeholder={t("wizard.repositoryPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {availableRepositories.map((repo) => (
                <SelectItem key={repo.id} value={String(repo.id)}>
                  <CodeRepositoryName
                    name={repo.name}
                    provider={repo.provider}
                    branch={repo.branch}
                  />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="webhook-wizard-base-branch">
            {t("codeRepos.baseBranch")}
          </Label>
          <Input
            id="webhook-wizard-base-branch"
            data-testid="webhook-wizard-base-branch"
            value={baseBranch}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setBaseBranch(e.target.value)
            }
            placeholder={
              repository?.branch ?? t("codeRepos.baseBranchPlaceholder")
            }
          />
          <p className="text-xs text-muted-foreground">
            {t("codeRepos.baseBranchHelp")}
          </p>
        </div>
        <div className="space-y-3">
          <Label className="flex items-start gap-3">
            <Switch
              checked={pullRequestsOn}
              onCheckedChange={setPullRequestsOn}
              data-testid="webhook-wizard-event-pull-request"
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
              onCheckedChange={setPushesOn}
              data-testid="webhook-wizard-event-push"
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
              onCheckedChange={setBranchPushesOn}
              data-testid="webhook-wizard-event-branch-push"
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
        {needsCredentials && renderCredentials()}
      </div>
    );
  }

  function renderConnectStep(rev: Revealed) {
    const setupKey =
      source === "repository" && adapterType
        ? REPOSITORY_SETUP_KEY[adapterType]
        : null;
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
        {source === "issues" && issueAdapter && (
          <div className="space-y-1">
            <div className="text-xs font-medium">{t("setupStepsTitle")}</div>
            <ol className="list-decimal space-y-1 ps-5 text-xs text-muted-foreground">
              {ISSUE_SETUP_STEP_KEYS[issueAdapter].map((key) => (
                <li key={key}>{t(key as any)}</li>
              ))}
            </ol>
          </div>
        )}
        {setupKey && (
          <div className="space-y-1">
            <div className="text-xs font-medium">{t("setupStepsTitle")}</div>
            <p className="text-xs text-muted-foreground">
              {t(setupKey as any)}
            </p>
          </div>
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
        {source === "issues" && (
          <p className="border-t border-primary/20 pt-2 text-xs text-muted-foreground">
            {t("nextSteps")}
          </p>
        )}
      </div>
    );
  }

  return (
    <DialogContent
      className="flex max-h-[90vh] flex-col sm:max-w-xl"
      data-testid="webhook-inbound-wizard"
      onInteractOutside={(e) => {
        if (isCreating) e.preventDefault();
      }}
    >
      <DialogHeader>
        <DialogTitle>{t("inboundAddButton")}</DialogTitle>
        <DialogDescription>{t("wizard.description")}</DialogDescription>
      </DialogHeader>
      <WizardStepIndicator
        currentStep={step}
        totalSteps={3}
        labels={[
          tGlobal("repository.codePins.source"),
          tGlobal("admin.integrations.table.configure"),
          t("wizard.stepConnect"),
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-1">
        {step === 1 && renderSourceStep()}
        {step === 2 &&
          (source === "issues" && issueAdapter
            ? renderIssueDetails(issueAdapter)
            : renderRepositoryDetails())}
        {step === 3 && revealed && renderConnectStep(revealed)}
      </div>
      <DialogFooter>
        {step === 1 && (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="webhook-wizard-cancel"
            >
              {tCommon("cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => setStep(2)}
              disabled={
                source === null ||
                (source === "issues" && !issuesAvailable) ||
                (source === "repository" && !repositoryAvailable)
              }
              data-testid="webhook-wizard-next"
            >
              {tActions("next")}
            </Button>
          </>
        )}
        {step === 2 && (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep(1)}
              disabled={isCreating}
              data-testid="webhook-wizard-back"
            >
              {tActions("back")}
            </Button>
            <Button
              type="button"
              onClick={() => void create()}
              disabled={!canCreate}
              data-testid="webhook-create-button"
            >
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              <span>{t("createButton")}</span>
            </Button>
          </>
        )}
        {step === 3 && (
          <Button
            type="button"
            onClick={() => onOpenChange(false)}
            data-testid="webhook-reveal-done-button"
          >
            <Check className="h-4 w-4" />
            <span>{t("revealDone")}</span>
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}
