"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DateFormatter } from "@/components/DateFormatter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Asterisk,
  DownloadCloud,
  PlugZap,
  Settings2,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { QaseMappingStep } from "./QaseMappingStep";
import LoadingSpinner from "~/components/LoadingSpinner";
import { apiFetch } from "~/lib/basePath";
import { QASE_ENTITY_ORDER } from "~/services/imports/qase/entities";
import type {
  QaseImportJobPayload,
  QaseProjectSummary,
} from "~/services/imports/qase/types";
import {
  StepSection,
  WizardProgress,
  type StepStatus,
  type WizardStepDefinition,
} from "./ImportWizardLayout";

enum WizardStep {
  Connect = 0,
  Fetch = 1,
  Configure = 2,
  Import = 3,
}

const QASE_DEFAULT_HOST = "api.qase.io";
const ERROR_CODES = new Set([
  "unauthorized",
  "invalid_host",
  "rate_limited",
  "request_failed",
  "bad_response",
]);
const ACTIVE_STATUSES = new Set(["QUEUED", "RUNNING"]);
// Fetched for the import's own use; not data an administrator entered.
const COUNTED_ENTITIES = QASE_ENTITY_ORDER.filter(
  (entity) => entity !== "author" && entity !== "system_field"
);
const IMPORT_PROGRESS_ROWS = [
  "folders",
  "sharedSteps",
  "cases",
  "milestones",
  "runs",
  "results",
  "files",
] as const;
const WARNING_CODES = new Set([
  "option_unmatched",
  "image_failed",
  "attachment_failed",
  "case_failed",
  "shared_step_missing",
  "shared_step_files_skipped",
  "parameter_rows_skipped",
  "storage_not_configured",
  "run_failed",
  "run_case_missing",
  "result_failed",
  "result_skipped",
]);

type ErrorKey =
  | "unauthorized"
  | "invalid_host"
  | "rate_limited"
  | "request_failed"
  | "bad_response"
  | "generic";

async function readErrorKey(response: Response): Promise<ErrorKey> {
  const body = await response.json().catch(() => null);
  return typeof body?.code === "string" && ERROR_CODES.has(body.code)
    ? (body.code as ErrorKey)
    : "generic";
}

export function QaseImportPanel() {
  const t = useTranslations("admin.imports.qase");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const dateTimeFormat = `${
    session?.user?.preferences?.dateFormat ?? "MM-dd-yyyy"
  } ${session?.user?.preferences?.timeFormat ?? "HH:mm"}`;

  const [token, setToken] = useState("");
  const [host, setHost] = useState(QASE_DEFAULT_HOST);
  const [projects, setProjects] = useState<QaseProjectSummary[] | null>(null);
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"connect" | "fetch" | "action" | null>(null);
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [showMapping, setShowMapping] = useState(false);

  const { data: job } = useQuery({
    queryKey: ["qase-import-job", jobId],
    enabled: !!jobId,
    queryFn: async (): Promise<QaseImportJobPayload> => {
      const response = await apiFetch(`/api/imports/qase/jobs/${jobId}`);
      if (!response.ok) {
        throw new Error("Failed to load the import");
      }
      return (await response.json()).job;
    },
    refetchInterval: (query) =>
      query.state.data && ACTIVE_STATUSES.has(query.state.data.status)
        ? 1000
        : false,
  });

  const { data: history = [] } = useQuery({
    queryKey: ["qase-import-jobs"],
    queryFn: async (): Promise<QaseImportJobPayload[]> => {
      const response = await apiFetch("/api/imports/qase/jobs?limit=20");
      if (!response.ok) {
        throw new Error("Failed to list imports");
      }
      return (await response.json()).jobs;
    },
  });

  const jobStatus = job?.status;
  useEffect(() => {
    if (jobStatus) {
      void queryClient.invalidateQueries({ queryKey: ["qase-import-jobs"] });
    }
  }, [jobStatus, queryClient]);

  const inImport =
    !!job &&
    (job.phase === "IMPORTING" ||
      job.status === "COMPLETED" ||
      !!job.importProgress);
  const activeStep = !jobId
    ? WizardStep.Connect
    : inImport
      ? WizardStep.Import
      : showMapping && job?.status === "READY"
        ? WizardStep.Configure
        : WizardStep.Fetch;

  const wizardSteps = useMemo<WizardStepDefinition[]>(
    () => [
      { id: WizardStep.Connect, label: t("steps.connect"), icon: PlugZap },
      { id: WizardStep.Fetch, label: t("steps.fetch"), icon: DownloadCloud },
      { id: WizardStep.Configure, label: t("steps.mapping"), icon: Settings2 },
      { id: WizardStep.Import, label: t("steps.import"), icon: Activity },
    ],
    [t]
  );

  const startOver = useCallback(() => {
    setJobId(null);
    setShowMapping(false);
    setProjects(null);
    setSelectedCodes(new Set());
    setToken("");
    setErrorKey(null);
  }, []);

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("connect");
    setErrorKey(null);
    setProjects(null);
    try {
      const response = await apiFetch("/api/imports/qase/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, host }),
      });
      if (!response.ok) {
        setErrorKey(await readErrorKey(response));
        return;
      }
      const body: { projects: QaseProjectSummary[] } = await response.json();
      setProjects(body.projects);
      setSelectedCodes(new Set(body.projects.map((project) => project.code)));
    } catch {
      setErrorKey("generic");
    } finally {
      setBusy(null);
    }
  };

  const startFetch = async () => {
    setBusy("fetch");
    setErrorKey(null);
    try {
      const response = await apiFetch("/api/imports/qase/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          host,
          projectCodes: [...selectedCodes],
        }),
      });
      if (!response.ok) {
        setErrorKey(await readErrorKey(response));
        return;
      }
      const body: { job: QaseImportJobPayload } = await response.json();
      queryClient.setQueryData(["qase-import-job", body.job.id], body.job);
      setJobId(body.job.id);
      setToken("");
      await queryClient.invalidateQueries({ queryKey: ["qase-import-jobs"] });
    } catch {
      setErrorKey("generic");
    } finally {
      setBusy(null);
    }
  };

  const runJobAction = async (action: "cancel" | "retry") => {
    if (!jobId) {
      return;
    }
    setBusy("action");
    setErrorKey(null);
    try {
      const response = await apiFetch(`/api/imports/qase/jobs/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        setErrorKey("generic");
        return;
      }
      const body: { job: QaseImportJobPayload } = await response.json();
      queryClient.setQueryData(["qase-import-job", jobId], body.job);
    } catch {
      setErrorKey("generic");
    } finally {
      setBusy(null);
    }
  };

  const deleteJob = async () => {
    if (!jobId) {
      return;
    }
    setBusy("action");
    try {
      const response = await apiFetch(`/api/imports/qase/jobs/${jobId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setErrorKey("generic");
        return;
      }
      startOver();
      await queryClient.invalidateQueries({ queryKey: ["qase-import-jobs"] });
    } catch {
      setErrorKey("generic");
    } finally {
      setBusy(null);
    }
  };

  const toggleProject = (code: string, checked: boolean) => {
    setSelectedCodes((previous) => {
      const next = new Set(previous);
      if (checked) {
        next.add(code);
      } else {
        next.delete(code);
      }
      return next;
    });
  };

  const jobIsActive = !!job && ACTIVE_STATUSES.has(job.status);
  const fetchStatus: StepStatus =
    job?.status === "READY" || job?.status === "COMPLETED"
      ? "completed"
      : "active";

  const jobActions = (
    <div className="flex flex-wrap gap-2">
      {job?.status === "READY" && !inImport && (
        <Button
          type="button"
          data-testid="qase-continue-mapping-button"
          onClick={() => setShowMapping(true)}
        >
          {t("continueToMapping")}
        </Button>
      )}
      {jobIsActive && (
        <Button
          type="button"
          variant="outline"
          data-testid="qase-cancel-button"
          onClick={() => runJobAction("cancel")}
          disabled={job?.cancelRequested || busy !== null}
        >
          {job?.cancelRequested
            ? t("cancelRequested")
            : inImport
              ? t("cancelImport")
              : t("cancel")}
        </Button>
      )}
      {job?.status === "FAILED" && (
        <Button
          type="button"
          data-testid="qase-retry-button"
          onClick={() => runJobAction("retry")}
          disabled={busy !== null}
        >
          {t("retry")}
        </Button>
      )}
      {!jobIsActive && (
        <>
          <Button
            type="button"
            variant="outline"
            data-testid="qase-start-over-button"
            onClick={startOver}
          >
            {t("startOver")}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="destructive"
                data-testid="qase-delete-button"
                disabled={busy !== null}
              >
                {t("deleteJob")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("deleteConfirmDescription")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  data-testid="qase-delete-confirm"
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={deleteJob}
                >
                  {tCommon("actions.delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );

  const statusBadge = job && (
    <div className="flex flex-wrap items-center gap-2">
      <Badge
        data-testid="qase-job-status"
        variant={
          job.status === "FAILED" || job.status === "CANCELED"
            ? "destructive"
            : job.status === "READY" || job.status === "COMPLETED"
              ? "secondary"
              : "outline"
        }
      >
        {t(`status.${job.status}`)}
      </Badge>
      <span className="text-sm text-muted-foreground">
        {job.projects
          .map((project) => `${project.title} (${project.code})`)
          .join(", ")}
      </span>
    </div>
  );

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <WizardProgress
        steps={wizardSteps}
        activeStep={activeStep}
        maxUnlockedStep={activeStep}
      />

      {errorKey && (
        <Alert variant="destructive" data-testid="qase-import-error">
          <AlertDescription>{t(`errors.${errorKey}`)}</AlertDescription>
        </Alert>
      )}

      {activeStep === WizardStep.Connect && (
        <StepSection
          stepNumber={1}
          title={t("steps.connect")}
          status="active"
          statusLabel=""
        >
          <form className="space-y-4" onSubmit={connect}>
            <div className="space-y-2">
              <Label htmlFor="qase-token" className="flex items-center">
                {t("tokenLabel")}
                <sup>
                  <Asterisk className="h-3 w-3 text-destructive" />
                </sup>
              </Label>
              <Input
                id="qase-token"
                data-testid="qase-token-input"
                type="password"
                autoComplete="off"
                required
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("tokenHelp")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="qase-host">{t("hostLabel")}</Label>
              <Input
                id="qase-host"
                data-testid="qase-host-input"
                value={host}
                placeholder={QASE_DEFAULT_HOST}
                onChange={(event) => setHost(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("hostHelp")}</p>
            </div>
            <Button
              type="submit"
              data-testid="qase-connect-button"
              disabled={!token.trim() || busy !== null}
            >
              {busy === "connect" ? t("connecting") : t("connect")}
            </Button>
          </form>

          {projects && (
            <div className="space-y-3" data-testid="qase-project-list">
              <h4 className="text-sm font-semibold">{t("projectsHeading")}</h4>
              {projects.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("projectsEmpty")}
                </p>
              ) : (
                <ul className="space-y-2">
                  {projects.map((project) => (
                    <li
                      key={project.code}
                      className="flex items-start gap-3 rounded-md border p-3"
                    >
                      <Checkbox
                        id={`qase-project-${project.code}`}
                        data-testid={`qase-project-${project.code}`}
                        checked={selectedCodes.has(project.code)}
                        onCheckedChange={(checked) =>
                          toggleProject(project.code, checked === true)
                        }
                      />
                      <div className="space-y-1">
                        <Label htmlFor={`qase-project-${project.code}`}>
                          {`${project.title} (${project.code})`}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {t("projectCounts", {
                            cases: project.cases,
                            suites: project.suites,
                            runs: project.runs,
                          })}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <Button
                type="button"
                data-testid="qase-fetch-button"
                onClick={startFetch}
                disabled={selectedCodes.size === 0 || busy !== null}
              >
                {busy === "fetch" ? t("fetching") : t("fetch")}
              </Button>
            </div>
          )}
        </StepSection>
      )}

      {activeStep === WizardStep.Fetch && (
        <StepSection
          stepNumber={2}
          title={t("steps.fetch")}
          status={fetchStatus}
          statusLabel=""
          description={jobIsActive ? t("fetchDescription") : undefined}
        >
          {!job ? (
            <LoadingSpinner />
          ) : (
            <div className="space-y-4" data-testid="qase-fetch-status">
              {statusBadge}

              {job.status === "READY" && (
                <p className="text-sm">{t("fetchReady")}</p>
              )}
              {job.status === "CANCELED" && (
                <p className="text-sm">{t("fetchCanceled")}</p>
              )}
              {job.status === "FAILED" && (
                <Alert variant="destructive">
                  <AlertTitle>{t("fetchFailed")}</AlertTitle>
                  {job.error && (
                    <AlertDescription>{job.error}</AlertDescription>
                  )}
                </Alert>
              )}

              {job.status !== "CANCELED" && (
                <Table data-testid="qase-fetch-counts">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("entityColumn")}</TableHead>
                      <TableHead className="text-right">
                        {t("countColumn")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {COUNTED_ENTITIES.map((entity) => {
                      const entry = job.fetchProgress[entity];
                      return (
                        <TableRow
                          key={entity}
                          data-testid={`qase-count-${entity}`}
                        >
                          <TableCell>
                            {t(`entities.${entity}` as "entities.case")}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {!entry
                              ? "–"
                              : entry.done || entry.total === null
                                ? entry.fetched.toLocaleString()
                                : t("countOfTotal", {
                                    fetched: entry.fetched,
                                    total: entry.total,
                                  })}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}

              {jobActions}
            </div>
          )}
        </StepSection>
      )}

      {activeStep === WizardStep.Configure && jobId && (
        <StepSection
          stepNumber={3}
          title={t("steps.mapping")}
          status="active"
          statusLabel=""
          description={t("mapping.description")}
        >
          <QaseMappingStep
            jobId={jobId}
            onStarted={(started) => {
              queryClient.setQueryData(["qase-import-job", jobId], started);
              setShowMapping(false);
              void queryClient.invalidateQueries({
                queryKey: ["qase-import-jobs"],
              });
            }}
          />
          <Button
            type="button"
            variant="outline"
            data-testid="qase-mapping-back-button"
            onClick={() => setShowMapping(false)}
          >
            {t("mapping.back")}
          </Button>
        </StepSection>
      )}

      {activeStep === WizardStep.Import && job && (
        <StepSection
          stepNumber={4}
          title={t("steps.import")}
          status={job.status === "COMPLETED" ? "completed" : "active"}
          statusLabel=""
          description={jobIsActive ? t("importDescription") : undefined}
        >
          <div className="space-y-4" data-testid="qase-import-status">
            {statusBadge}

            {job.status === "COMPLETED" && (
              <p className="text-sm">{t("importCompleted")}</p>
            )}
            {job.status === "CANCELED" && (
              <p className="text-sm">{t("importCanceled")}</p>
            )}
            {job.status === "FAILED" && (
              <Alert variant="destructive">
                <AlertTitle>{t("importFailed")}</AlertTitle>
                {job.error && <AlertDescription>{job.error}</AlertDescription>}
              </Alert>
            )}

            {job.importProgress && (
              <Table data-testid="qase-import-counts">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("entityColumn")}</TableHead>
                    <TableHead className="text-right">
                      {t("importedColumn")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {IMPORT_PROGRESS_ROWS.map((row) => {
                    const entry = job.importProgress?.[row];
                    return (
                      <TableRow key={row} data-testid={`qase-imported-${row}`}>
                        <TableCell>{t(`importEntities.${row}`)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {entry
                            ? t("countOfTotal", {
                                fetched: entry.done - (entry.failed ?? 0),
                                total: entry.total,
                              })
                            : "–"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}

            {job.warnings.length > 0 && (
              <div className="space-y-2" data-testid="qase-import-warnings">
                <h4 className="text-sm font-semibold">
                  {t("warningsHeading", { count: job.warnings.length })}
                </h4>
                <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
                  {job.warnings.map((warning, index) => (
                    <li key={`${warning.code}-${index}`}>
                      {WARNING_CODES.has(warning.code)
                        ? t(
                            `warnings.${warning.code}` as "warnings.case_failed",
                            {
                              subject: warning.subject,
                            }
                          )
                        : warning.subject}
                      {warning.detail && (
                        <span className="text-muted-foreground">
                          {` (${warning.detail})`}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {jobActions}
          </div>
        </StepSection>
      )}

      <div className="space-y-3 rounded-md border bg-muted/10 p-4">
        <h4 className="text-sm font-semibold">{t("previousHeading")}</h4>
        {history.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("previousEmpty")}</p>
        ) : (
          <Select
            value={jobId ?? ""}
            onValueChange={(value) => {
              setErrorKey(null);
              setShowMapping(false);
              setJobId(value);
            }}
          >
            <SelectTrigger
              aria-label={t("previousPlaceholder")}
              data-testid="qase-previous-imports"
            >
              <SelectValue placeholder={t("previousPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {history.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  <span className="flex items-center gap-2">
                    <DateFormatter
                      date={entry.createdAt}
                      formatString={dateTimeFormat}
                      timezone={session?.user?.preferences?.timezone}
                      tooltip={false}
                    />
                    <span>{`· ${t(`status.${entry.status}`)} · ${entry.projects
                      .map((project) => project.code)
                      .join(", ")}`}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}
