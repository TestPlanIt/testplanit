"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, ArrowUpToLine, GitBranch } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CommitPicker,
  commitsUrl,
  toCommitRef,
  useCommitDateFormatter,
  type CommitRef,
  type CommitsResponse,
} from "../CommitPicker";
import type { ImpactRepoConfig } from "../ImpactDialog";
import { PullRequestPicker, type RepoPullRequest } from "../PullRequestPicker";

interface RepoBranch {
  name: string;
  sha: string;
  isDefault: boolean;
}

interface BranchesResponse {
  branches: RepoBranch[];
  defaultBranch: string | null;
  configuredBranch: string | null;
}

interface PreviousAnalysis {
  id: number;
  headSha: string;
  baseSha: string;
  createdAt: string;
  affectedCaseCount: number;
  status: string;
}

interface CommitPickerStepProps {
  projectId: number;
  config: ImpactRepoConfig;
  branch: string | null;
  base: CommitRef | null;
  head: CommitRef | null;
  sameCommit: boolean;
  onBranchChange: (branch: string | null) => void;
  onBaseChange: (commit: CommitRef | null) => void;
  onHeadChange: (commit: CommitRef | null) => void;
}

async function resolveRef(
  repositoryId: number,
  configId: number,
  ref: string
): Promise<{ commit: CommitRef | null; notFound: boolean }> {
  const response = await fetch(
    commitsUrl(repositoryId, configId, { ref, page: 1, perPage: 1 })
  );
  if (response.status === 404) return { commit: null, notFound: true };
  if (!response.ok) throw new Error("Failed to resolve ref");
  const data = (await response.json()) as CommitsResponse;
  const first = data.commits[0];
  return { commit: first ? toCommitRef(first) : null, notFound: !first };
}

function RefInput({
  id,
  testId,
  repositoryId,
  configId,
  onResolved,
}: {
  id: string;
  testId: string;
  repositoryId: number;
  configId: number;
  onResolved: (commit: CommitRef) => void;
}) {
  const t = useTranslations("runs.impact");
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<
    "idle" | "resolving" | "notFound" | "failed"
  >("idle");
  const [lastResolved, setLastResolved] = useState("");
  const requestRef = useRef(0);

  const resolve = useCallback(
    async (ref: string, { quiet }: { quiet: boolean }) => {
      const trimmed = ref.trim();
      if (!trimmed || trimmed === lastResolved) return;
      const requestId = ++requestRef.current;
      setStatus("resolving");
      try {
        const { commit, notFound } = await resolveRef(
          repositoryId,
          configId,
          trimmed
        );
        // A later keystroke started its own lookup; that one owns the field.
        if (requestId !== requestRef.current) return;
        if (notFound || !commit) {
          setStatus(quiet ? "idle" : "notFound");
          return;
        }
        setLastResolved(trimmed);
        setStatus("idle");
        onResolved(commit);
      } catch {
        if (requestId === requestRef.current) {
          setStatus(quiet ? "idle" : "failed");
        }
      }
    },
    [lastResolved, repositoryId, configId, onResolved]
  );

  // `resolve` is rebuilt whenever the parent re-renders, so the debounce reads
  // it through a ref: depending on it directly would restart the timer on every
  // render and race the explicit blur and Enter lookups.
  const latestResolve = useRef(resolve);
  useEffect(() => {
    latestResolve.current = resolve;
  });

  // Resolve while typing so the picker above never lags behind this box. A ref
  // half-typed is not an error yet, so only an explicit blur or Enter reports
  // one; the debounce keeps a paused sha from firing a request per character.
  useEffect(() => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === lastResolved) return;
    const timer = setTimeout(
      () => void latestResolve.current(trimmed, { quiet: true }),
      500
    );
    return () => clearTimeout(timer);
  }, [value, lastResolved]);

  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {t("pick.refLabel")}
      </Label>
      <Input
        id={id}
        value={value}
        placeholder={t("pick.refPlaceholder")}
        onChange={(event) => {
          setValue(event.target.value);
          if (status !== "idle") setStatus("idle");
        }}
        onBlur={() => void resolve(value, { quiet: false })}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void resolve(value, { quiet: false });
          }
        }}
        aria-invalid={status === "notFound" || status === "failed"}
        aria-busy={status === "resolving"}
        data-testid={testId}
        className="font-mono text-xs"
      />
      {status === "notFound" && (
        <p className="text-xs text-destructive">{t("pick.refNotFound")}</p>
      )}
      {status === "failed" && (
        <p className="text-xs text-destructive">{t("errors.commitsFailed")}</p>
      )}
    </div>
  );
}

export function CommitPickerStep({
  projectId,
  config,
  branch,
  base,
  head,
  sameCommit,
  onBranchChange,
  onBaseChange,
  onHeadChange,
}: CommitPickerStepProps) {
  const t = useTranslations("runs.impact");
  const formatDate = useCommitDateFormatter();
  const [branches, setBranches] = useState<RepoBranch[]>([]);
  const [branchesError, setBranchesError] = useState(false);
  const [branchesLoaded, setBranchesLoaded] = useState(false);
  const [previous, setPrevious] = useState<PreviousAnalysis[]>([]);
  const [previousValue, setPreviousValue] = useState<string>("");
  const [latestBusy, setLatestBusy] = useState(false);

  useEffect(() => {
    let ignore = false;
    const search = new URLSearchParams({ configId: String(config.id) });
    fetch(`/api/code-repositories/${config.repositoryId}/branches?${search}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to list branches");
        return (await response.json()) as BranchesResponse;
      })
      .then((data) => {
        if (ignore) return;
        setBranches(data.branches ?? []);
        setBranchesLoaded(true);
        if (branch === null) {
          onBranchChange(
            data.configuredBranch ?? data.defaultBranch ?? config.branch ?? null
          );
        }
      })
      .catch(() => {
        if (ignore) return;
        setBranchesError(true);
        setBranchesLoaded(true);
        if (branch === null && config.branch) onBranchChange(config.branch);
      });
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.id, config.repositoryId]);

  useEffect(() => {
    let ignore = false;
    fetch(`/api/projects/${projectId}/impact/analyses?take=10`)
      .then(async (response) => {
        if (!response.ok) return { analyses: [] as PreviousAnalysis[] };
        return (await response.json()) as { analyses: PreviousAnalysis[] };
      })
      .then((data) => {
        if (ignore) return;
        setPrevious(
          (data.analyses ?? []).filter((row) => row.status === "COMPLETED")
        );
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, [projectId]);

  const fetchBranchOptions = useCallback(
    async (query: string) => {
      const needle = query.trim().toLowerCase();
      const results = branches.filter(
        (item) =>
          needle.length === 0 || item.name.toLowerCase().includes(needle)
      );
      return { results, total: results.length };
    },
    [branches]
  );

  const branchValue: RepoBranch | null =
    branch === null
      ? null
      : (branches.find((item) => item.name === branch) ?? {
          name: branch,
          sha: "",
          isDefault: false,
        });

  const handleLatest = useCallback(async () => {
    if (!branch) return;
    setLatestBusy(true);
    try {
      const { commit } = await resolveRef(
        config.repositoryId,
        config.id,
        branch
      );
      if (commit) onHeadChange(commit);
    } catch {
      // The picker surfaces commit-load failures on its own.
    } finally {
      setLatestBusy(false);
    }
  }, [branch, config.repositoryId, config.id, onHeadChange]);

  const [mode, setMode] = useState<"commits" | "pull">("commits");
  const [pullRequest, setPullRequest] = useState<RepoPullRequest | null>(null);
  const [pullSupported, setPullSupported] = useState(true);
  const [pullError, setPullError] = useState(false);

  /**
   * A pull request stands in for the two commits. Providers that omit the base
   * sha from their list call leave the branch name, which resolves the same
   * way a typed ref does.
   */
  const handlePullRequest = useCallback(
    async (next: RepoPullRequest | null) => {
      setPullRequest(next);
      setPullError(false);
      if (!next) return;
      try {
        // Judge the branch from where it diverged, not from the target tip, so
        // the diff is what this pull request did. Providers that cannot say
        // return null and we keep the base they gave us.
        let baseRef = next.baseSha ?? next.targetBranch;
        try {
          const mergeBaseResponse = await fetch(
            `/api/code-repositories/${config.repositoryId}/merge-base` +
              `?configId=${config.id}&base=${encodeURIComponent(baseRef)}` +
              `&head=${encodeURIComponent(next.headSha ?? next.sourceBranch)}`
          );
          if (mergeBaseResponse.ok) {
            const { sha } = (await mergeBaseResponse.json()) as {
              sha: string | null;
            };
            if (sha) baseRef = sha;
          }
        } catch {
          // The provider's own base still gives a usable comparison.
        }

        const [baseCommit, headCommit] = await Promise.all([
          /^[0-9a-f]{7,40}$/i.test(baseRef)
            ? Promise.resolve({
                commit: {
                  sha: baseRef,
                  shortSha: baseRef.slice(0, 7),
                } as CommitRef,
              })
            : resolveRef(config.repositoryId, config.id, baseRef),
          next.headSha
            ? Promise.resolve({
                commit: {
                  sha: next.headSha,
                  shortSha: next.headSha.slice(0, 7),
                } as CommitRef,
              })
            : resolveRef(config.repositoryId, config.id, next.sourceBranch),
        ]);
        if (!baseCommit.commit || !headCommit.commit) {
          setPullError(true);
          return;
        }
        onBaseChange(baseCommit.commit);
        onHeadChange(headCommit.commit);
      } catch {
        setPullError(true);
      }
    },
    [config.repositoryId, config.id, onBaseChange, onHeadChange]
  );

  const handlePrevious = useCallback(
    (value: string) => {
      setPreviousValue(value);
      const row = previous.find((item) => String(item.id) === value);
      if (!row) return;
      onBaseChange({ sha: row.headSha, shortSha: row.headSha.slice(0, 7) });
    },
    [previous, onBaseChange]
  );

  return (
    <div className="space-y-4 py-2">
      {pullSupported && (
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(next) => {
            if (next) setMode(next as "commits" | "pull");
          }}
          variant="outline"
          size="sm"
          className="justify-start"
          aria-label={t("pick.modeLabel")}
        >
          <ToggleGroupItem value="commits" data-testid="impact-mode-commits">
            {t("pick.modeCommits")}
          </ToggleGroupItem>
          <ToggleGroupItem value="pull" data-testid="impact-mode-pull">
            {t("pick.modePull")}
          </ToggleGroupItem>
        </ToggleGroup>
      )}

      {pullSupported && (
        // Say which question the mode answers, so nobody has to infer it from
        // the results.
        <p
          className="text-xs text-muted-foreground"
          data-testid="impact-mode-hint"
        >
          {t(mode === "pull" ? "pick.modePullHint" : "pick.modeCommitsHint")}
        </p>
      )}
      {branchesError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{t("errors.branchesFailed")}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-1">
        <Label>{t("pick.branchLabel")}</Label>
        <AsyncCombobox<RepoBranch>
          value={branchValue}
          onValueChange={(item) => onBranchChange(item?.name ?? null)}
          fetchOptions={fetchBranchOptions}
          renderOption={(item) => (
            <div className="flex items-center gap-2 text-sm">
              <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate font-mono text-xs">{item.name}</span>
            </div>
          )}
          getOptionValue={(item) => item.name}
          ariaLabel={t("pick.branchLabel")}
          disabled={!branchesLoaded}
          showPagination={false}
          minDropdownWidth={280}
          className="w-full sm:w-80"
          renderTrigger={({ defaultContent, loading }) => (
            <button
              type="button"
              className="group flex h-9 w-full items-center justify-start rounded-md border border-input bg-background px-3 py-2 text-start text-sm shadow-xs hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:w-80"
              data-testid="impact-branch"
              data-loading={loading ? "true" : undefined}
            >
              <span className="min-w-0 flex-1 truncate">{defaultContent}</span>
            </button>
          )}
        />
      </div>

      {mode === "pull" && (
        <div className="space-y-2">
          <PullRequestPicker
            repositoryId={config.repositoryId}
            configId={config.id}
            value={pullRequest}
            onValueChange={(next) => void handlePullRequest(next)}
            onUnsupported={() => {
              setPullSupported(false);
              setMode("commits");
            }}
          />
          {pullError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{t("errors.pullFailed")}</AlertDescription>
            </Alert>
          )}
          {pullRequest && base && head && !pullError && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="impact-pull-request-range"
            >
              {t("pull.resolved", {
                base: base.shortSha,
                head: head.shortSha,
                target: pullRequest.targetBranch,
                source: pullRequest.sourceBranch,
              })}
            </p>
          )}
        </div>
      )}

      <div className={mode === "pull" ? "hidden" : "grid gap-4 md:grid-cols-2"}>
        <div className="space-y-2">
          <div className="flex h-8 items-center">
            <Label>{t("pick.baseLabel")}</Label>
          </div>
          <CommitPicker
            repositoryId={config.repositoryId}
            configId={config.id}
            branch={branch}
            value={base}
            onValueChange={onBaseChange}
            ariaLabel={t("pick.baseLabel")}
            testId="impact-base-commit"
          />
          <RefInput
            id="impact-base-ref"
            testId="impact-base-ref-input"
            repositoryId={config.repositoryId}
            configId={config.id}
            onResolved={onBaseChange}
          />
          {previous.length > 0 && (
            <div className="space-y-1">
              <Label
                htmlFor="impact-previous-analysis"
                className="text-xs text-muted-foreground"
              >
                {t("pick.previousAnalysisLabel")}
              </Label>
              <Select value={previousValue} onValueChange={handlePrevious}>
                <SelectTrigger
                  id="impact-previous-analysis"
                  data-testid="impact-previous-analysis"
                  className="w-full"
                >
                  <SelectValue
                    placeholder={t("pick.previousAnalysisPlaceholder")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {previous.map((row) => (
                    <SelectItem key={row.id} value={String(row.id)}>
                      {t("pick.previousAnalysisOption", {
                        sha: row.headSha.slice(0, 7),
                        date: formatDate(row.createdAt),
                        count: row.affectedCaseCount,
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex h-8 items-center justify-between">
            <Label>{t("pick.headLabel")}</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleLatest()}
              disabled={!branch || latestBusy}
              data-testid="impact-latest-on-branch"
            >
              <ArrowUpToLine className="h-3.5 w-3.5" />
              {t("pick.latestOnBranch", { branch: branch ?? "" })}
            </Button>
          </div>
          <CommitPicker
            repositoryId={config.repositoryId}
            configId={config.id}
            branch={branch}
            value={head}
            onValueChange={onHeadChange}
            ariaLabel={t("pick.headLabel")}
            testId="impact-head-commit"
          />
          <RefInput
            id="impact-head-ref"
            testId="impact-head-ref-input"
            repositoryId={config.repositoryId}
            configId={config.id}
            onResolved={onHeadChange}
          />
        </div>
      </div>

      {mode === "commits" && (
        <p className="text-xs text-muted-foreground">{t("pick.searchHint")}</p>
      )}

      {sameCommit && (
        <Alert variant="destructive" data-testid="impact-same-commit">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{t("pick.sameCommit")}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
