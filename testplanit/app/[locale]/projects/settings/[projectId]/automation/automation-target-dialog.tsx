"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import {
  createExecutionTarget,
  getRepositoryDispatchOptions,
  updateExecutionTarget,
  type ExecutionTargetInput,
  type ExecutionTargetView,
  type RepositoryDispatchOptions,
} from "~/app/actions/execution-targets";
import { translateServerError } from "~/lib/i18n/translateServerError";
import {
  inputsToRows,
  rowsToInputs,
  StaticInputsEditor,
  type StaticInputRow,
} from "@/components/automation/StaticInputsEditor";

type Provider = ExecutionTargetView["provider"];

const REPO_PROVIDER: Record<Exclude<Provider, "GENERIC_WEBHOOK">, string> = {
  GITHUB_ACTIONS: "GITHUB",
  GITLAB_CI: "GITLAB",
};

const DEFAULT_BRANCH = "__default__";
const PAYLOAD_PREVIEW = `{
  "event": "test_run.execute",
  "executionId": 17,
  "runId": 42,
  "projectId": 9,
  "ref": "main",
  "planUrl": "https://…/api/test-runs/42/automation-plan?executionId=17",
  "appUrl": "https://…",
  "inputs": { "TESTPLANIT_RUN_ID": "42", "…": "…" },
  "requestedAt": "2026-09-10T10:00:00.000Z"
}
X-TestPlanIt-Signature: t=<unix>,v1=<hmac-sha256 of "<unix>.<body>">`;

interface Props {
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ExecutionTargetView | null;
  onSaved: (target: ExecutionTargetView, revealedSecret?: string) => void;
}

export function AutomationTargetDialog({
  projectId,
  open,
  onOpenChange,
  target,
  onSaved,
}: Props) {
  const t = useTranslations("automation.settings");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  const [name, setName] = useState("");
  const [provider, setProvider] = useState<Provider>("GITHUB_ACTIONS");
  const [repositoryId, setRepositoryId] = useState<string>("");
  const [workflowRef, setWorkflowRef] = useState("");
  const [ref, setRef] = useState<string>(DEFAULT_BRANCH);
  const [url, setUrl] = useState("");
  const [rows, setRows] = useState<StaticInputRow[]>([]);
  const [timeoutMinutes, setTimeoutMinutes] = useState(120);
  const [overrideCredentials, setOverrideCredentials] = useState(false);
  const [clearCredentials, setClearCredentials] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [triggerToken, setTriggerToken] = useState("");
  const [customSecret, setCustomSecret] = useState(false);
  const [secret, setSecret] = useState("");
  const [rotateSecret, setRotateSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [options, setOptions] = useState<RepositoryDispatchOptions | null>(
    null
  );
  const [optionsLoading, setOptionsLoading] = useState(false);

  // Reset the form whenever the dialog opens for a (different) target.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setOverrideCredentials(false);
    setClearCredentials(false);
    setAccessToken("");
    setTriggerToken("");
    setCustomSecret(false);
    setSecret("");
    setRotateSecret(false);
    setOptions(null);
    if (target) {
      setName(target.name);
      setProvider(target.provider);
      setRepositoryId(
        target.codeRepository ? String(target.codeRepository.id) : ""
      );
      setWorkflowRef(target.workflowRef ?? "");
      setRef(target.defaultRef ?? DEFAULT_BRANCH);
      setUrl(target.url ?? "");
      setRows(inputsToRows(target.staticInputs));
      setTimeoutMinutes(target.timeoutMinutes);
    } else {
      setName("");
      setProvider("GITHUB_ACTIONS");
      setRepositoryId("");
      setWorkflowRef("");
      setRef(DEFAULT_BRANCH);
      setUrl("");
      setRows([]);
      setTimeoutMinutes(120);
    }
  }, [open, target]);

  const isGeneric = provider === "GENERIC_WEBHOOK";
  const repoProvider = isGeneric ? null : REPO_PROVIDER[provider];

  const { data: repositories, isLoading: repositoriesLoading } =
    useClientQueries(schema).codeRepository.useFindMany(
      {
        where: {
          isDeleted: false,
          status: "ACTIVE",
          ...(repoProvider ? { provider: repoProvider as never } : {}),
        },
        select: { id: true, name: true, provider: true },
        orderBy: { name: "asc" },
      },
      { enabled: open && !isGeneric }
    );

  // Discovery: branches for both git providers, workflow files for GitHub.
  useEffect(() => {
    if (!open || isGeneric || !repositoryId) {
      setOptions(null);
      return;
    }
    let cancelled = false;
    setOptionsLoading(true);
    void getRepositoryDispatchOptions(projectId, Number(repositoryId)).then(
      (result) => {
        if (cancelled) return;
        setOptionsLoading(false);
        if (result.success) {
          setOptions({
            workflows: result.workflows,
            branches: result.branches,
            defaultBranch: result.defaultBranch,
            warning: result.warning,
          });
        } else {
          setOptions({
            workflows: [],
            branches: [],
            defaultBranch: null,
            warning: result.error,
          });
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [open, isGeneric, repositoryId, projectId]);

  const workflowChoices = useMemo(() => options?.workflows ?? [], [options]);
  const branchChoices = useMemo(() => options?.branches ?? [], [options]);
  const canPickWorkflow = workflowChoices.length > 0;
  const canPickBranch = branchChoices.length > 0;
  const workflowValue = useMemo(() => {
    if (!canPickWorkflow) return "";
    const match = workflowChoices.find(
      (w) =>
        w.path === workflowRef ||
        w.id === workflowRef ||
        w.path.split("/").pop() === workflowRef
    );
    return match?.path ?? "";
  }, [canPickWorkflow, workflowChoices, workflowRef]);

  const handleSubmit = async () => {
    setError(null);
    setSaving(true);
    try {
      const credentials: ExecutionTargetInput["credentials"] = isGeneric
        ? customSecret && secret
          ? { secret }
          : undefined
        : clearCredentials
          ? null
          : overrideCredentials
            ? {
                ...(accessToken ? { personalAccessToken: accessToken } : {}),
                ...(triggerToken ? { triggerToken } : {}),
              }
            : undefined;
      const input: ExecutionTargetInput = {
        name: name.trim(),
        provider,
        codeRepositoryId: isGeneric ? null : Number(repositoryId) || null,
        workflowRef:
          provider === "GITHUB_ACTIONS" ? workflowRef.trim() || null : null,
        defaultRef: ref === DEFAULT_BRANCH ? null : ref.trim() || null,
        url: isGeneric ? url.trim() || null : null,
        staticInputs: rowsToInputs(rows),
        timeoutMinutes,
        credentials,
        rotateSecret: isGeneric && rotateSecret,
      };
      const result = target
        ? await updateExecutionTarget(target.id, input)
        : await createExecutionTarget(projectId, input);
      if (!result.success) {
        setError(translateServerError(tGlobal, result, result.error));
        return;
      }
      onOpenChange(false);
      onSaved(result.target, result.revealedSecret);
    } finally {
      setSaving(false);
    }
  };

  const providerOptions: Provider[] = [
    "GITHUB_ACTIONS",
    "GITLAB_CI",
    "GENERIC_WEBHOOK",
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        data-testid="automation-target-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {target ? t("editTitle") : t("createTitle")}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="automation-target-name">{t("name")}</Label>
            <Input
              id="automation-target-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("namePlaceholder")}
              data-testid="automation-target-name-input"
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t("provider")}</Label>
            <Select
              value={provider}
              onValueChange={(v) => {
                setProvider(v as Provider);
                setRepositoryId("");
                setWorkflowRef("");
                setOptions(null);
              }}
              disabled={Boolean(target)}
            >
              <SelectTrigger data-testid="automation-target-provider-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providerOptions.map((p) => (
                  <SelectItem key={p} value={p}>
                    {tGlobal(`enums.ExecutionProvider.${p}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!isGeneric && (
            <>
              <div className="space-y-1.5">
                <Label>{t("repository")}</Label>
                {!repositoriesLoading && (repositories?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("noRepositories", { provider: repoProvider ?? "" })}
                  </p>
                ) : (
                  <Select
                    value={repositoryId}
                    onValueChange={(v) => {
                      setRepositoryId(v);
                      setWorkflowRef("");
                      setRef(DEFAULT_BRANCH);
                    }}
                  >
                    <SelectTrigger data-testid="automation-target-repository-select">
                      <SelectValue placeholder={t("repositoryPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {(repositories ?? []).map((repo) => (
                        <SelectItem key={repo.id} value={String(repo.id)}>
                          {repo.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {provider === "GITHUB_ACTIONS" && (
                <div className="space-y-1.5">
                  <Label>{t("workflow")}</Label>
                  {optionsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>{tCommon("loading")}</span>
                    </div>
                  ) : canPickWorkflow ? (
                    <Select
                      value={workflowValue}
                      onValueChange={(v) =>
                        setWorkflowRef(v.split("/").pop() ?? v)
                      }
                    >
                      <SelectTrigger data-testid="automation-target-workflow-select">
                        <SelectValue placeholder={t("workflowPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {workflowChoices.map((w) => (
                          <SelectItem key={w.id} value={w.path}>
                            {w.name}{" "}
                            <span className="font-mono text-xs text-muted-foreground">
                              {w.path.split("/").pop()}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={workflowRef}
                      onChange={(e) => setWorkflowRef(e.target.value)}
                      placeholder={t("workflowInputPlaceholder")}
                      className="font-mono text-sm"
                      data-testid="automation-target-workflow-input"
                    />
                  )}
                  {options?.warning && !canPickWorkflow && (
                    <p className="text-xs text-muted-foreground">
                      {t("workflowsUnavailable", { error: options.warning })}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t("workflowHelp")}
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <Label>{t("defaultRef")}</Label>
                {canPickBranch ? (
                  <Select value={ref} onValueChange={setRef}>
                    <SelectTrigger data-testid="automation-target-ref-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEFAULT_BRANCH}>
                        {t("defaultRefDefault")}
                        {options?.defaultBranch && (
                          <span className="ms-2 font-mono text-xs text-muted-foreground">
                            {options.defaultBranch}
                          </span>
                        )}
                      </SelectItem>
                      {branchChoices.map((b) => (
                        <SelectItem key={b} value={b}>
                          <span className="font-mono text-sm">{b}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={ref === DEFAULT_BRANCH ? "" : ref}
                    onChange={(e) => setRef(e.target.value || DEFAULT_BRANCH)}
                    placeholder={t("defaultRefPlaceholder")}
                    className="font-mono text-sm"
                    data-testid="automation-target-ref-input"
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  {t("defaultRefHelp")}
                </p>
              </div>

              <div className="space-y-2 rounded-md border p-3">
                <Label>{t("credentials")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("credentialsHelp")}
                </p>
                {target?.hasOwnCredentials && (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={clearCredentials}
                      onCheckedChange={(v) => {
                        setClearCredentials(v === true);
                        if (v === true) setOverrideCredentials(false);
                      }}
                      data-testid="automation-target-clear-credentials"
                    />
                    <span>{t("clearCredentials")}</span>
                  </label>
                )}
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={overrideCredentials}
                    disabled={clearCredentials}
                    onCheckedChange={(v) => setOverrideCredentials(v === true)}
                    data-testid="automation-target-override-credentials"
                  />
                  <span>{t("credentialsOverride")}</span>
                </label>
                {overrideCredentials && (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label htmlFor="automation-target-pat">
                        {t("personalAccessToken")}
                      </Label>
                      <Input
                        id="automation-target-pat"
                        type="password"
                        autoComplete="off"
                        value={accessToken}
                        onChange={(e) => setAccessToken(e.target.value)}
                        data-testid="automation-target-pat-input"
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("personalAccessTokenHelp")}
                      </p>
                    </div>
                    {provider === "GITLAB_CI" && (
                      <div className="space-y-1">
                        <Label htmlFor="automation-target-trigger-token">
                          {t("triggerToken")}
                        </Label>
                        <Input
                          id="automation-target-trigger-token"
                          type="password"
                          autoComplete="off"
                          value={triggerToken}
                          onChange={(e) => setTriggerToken(e.target.value)}
                          data-testid="automation-target-trigger-token-input"
                        />
                        <p className="text-xs text-muted-foreground">
                          {t("triggerTokenHelp")}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {isGeneric && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="automation-target-url">{t("webhookUrl")}</Label>
                <Input
                  id="automation-target-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t("webhookUrlPlaceholder")}
                  className="font-mono text-sm"
                  data-testid="automation-target-webhook-url-input"
                />
                <p className="text-xs text-muted-foreground">
                  {t("webhookUrlHelp")}
                </p>
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <Label>{t("secret")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("secretHelp")}
                </p>
                {target && (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={rotateSecret}
                      onCheckedChange={(v) => setRotateSecret(v === true)}
                      data-testid="automation-target-rotate-secret"
                    />
                    <span>{t("rotateSecret")}</span>
                  </label>
                )}
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={customSecret}
                    onCheckedChange={(v) => setCustomSecret(v === true)}
                    data-testid="automation-target-custom-secret"
                  />
                  <span>{t("secretCustom")}</span>
                </label>
                {customSecret && (
                  <Input
                    type="password"
                    autoComplete="off"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    data-testid="automation-target-secret-input"
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <Label>{t("payloadPreview")}</Label>
                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                  {PAYLOAD_PREVIEW}
                </pre>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="automation-target-generic-ref">
                  {t("defaultRef")}
                </Label>
                <Input
                  id="automation-target-generic-ref"
                  value={ref === DEFAULT_BRANCH ? "" : ref}
                  onChange={(e) => setRef(e.target.value || DEFAULT_BRANCH)}
                  placeholder={t("defaultRefPlaceholder")}
                  className="font-mono text-sm"
                  data-testid="automation-target-ref-input"
                />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label>
              {isGeneric
                ? t("webhookVariables")
                : provider === "GITLAB_CI"
                  ? t("variables")
                  : t("staticInputs")}
            </Label>
            <StaticInputsEditor rows={rows} onChange={setRows} />
            <p className="text-xs text-muted-foreground">
              {t("staticInputsHelp")}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="automation-target-timeout">{t("timeout")}</Label>
            <Input
              id="automation-target-timeout"
              type="number"
              min={5}
              max={24 * 60}
              value={timeoutMinutes}
              onChange={(e) =>
                setTimeoutMinutes(
                  Math.min(24 * 60, Math.max(5, Number(e.target.value) || 5))
                )
              }
              className="w-32"
              data-testid="automation-target-timeout-input"
            />
            <p className="text-xs text-muted-foreground">{t("timeoutHelp")}</p>
          </div>

          {error && (
            <p
              className="text-sm text-destructive"
              role="alert"
              data-testid="automation-target-error"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="automation-target-cancel"
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving || !name.trim()}
            data-testid="automation-target-submit"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>{tCommon("actions.save")}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
