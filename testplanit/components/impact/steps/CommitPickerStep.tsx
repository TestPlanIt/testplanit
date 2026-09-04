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
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import {
  CommitPicker,
  commitsUrl,
  toCommitRef,
  useCommitDateFormatter,
  type CommitRef,
  type CommitsResponse,
} from "../CommitPicker";
import type { ImpactRepoConfig } from "../ImpactDialog";

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

  const resolve = useCallback(async () => {
    const ref = value.trim();
    if (!ref || ref === lastResolved) return;
    setStatus("resolving");
    try {
      const { commit, notFound } = await resolveRef(
        repositoryId,
        configId,
        ref
      );
      if (notFound || !commit) {
        setStatus("notFound");
        return;
      }
      setLastResolved(ref);
      setStatus("idle");
      onResolved(commit);
    } catch {
      setStatus("failed");
    }
  }, [value, lastResolved, repositoryId, configId, onResolved]);

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
        onBlur={() => void resolve()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void resolve();
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

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>{t("pick.baseLabel")}</Label>
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
          <div className="flex items-center justify-between">
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

      <p className="text-xs text-muted-foreground">{t("pick.searchHint")}</p>

      {sameCommit && (
        <Alert variant="destructive" data-testid="impact-same-commit">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{t("pick.sameCommit")}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
