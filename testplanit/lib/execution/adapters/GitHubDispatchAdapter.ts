import { ciRequest, CiRequestError, type CiResponse } from "../http";
import { RESERVED_INPUT_KEYS } from "../types";
import type {
  DispatchCapability,
  DispatchRequest,
  DispatchResult,
  ExternalStatus,
  WorkflowChoice,
} from "../types";
import { CiDispatchAdapter, DispatchError } from "./CiDispatchAdapter";

interface GitHubWorkflow {
  id: number;
  name: string;
  path: string;
  state?: string;
}

interface GitHubRun {
  id: number;
  html_url?: string;
  status?: string;
  conclusion?: string | null;
}

/**
 * GitHub Actions `workflow_dispatch`.
 *
 * Correlation: the run id is minted before dispatch and travels in the
 * inputs; the GitHub run id is a bonus. github.com returns it when
 * `return_run_details=true` is passed (Feb 2026); GitHub Enterprise Server
 * answers 204 with nothing, in which case the first status poll may adopt a
 * lone `workflow_dispatch` run created after the dispatch on the same branch.
 *
 * Inputs must be declared in the workflow file or GitHub answers 422 — the
 * verify path parses the file so the settings UI can warn ahead of time.
 */
export class GitHubDispatchAdapter extends CiDispatchAdapter {
  readonly supportsStatusPolling = true;

  private readonly token: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly apiBase: string;
  private readonly workflowRef: string;

  constructor(
    credentials: Record<string, string>,
    settings: Record<string, string> | null | undefined,
    workflowRef: string | null | undefined
  ) {
    super();
    this.token = credentials.personalAccessToken ?? "";
    this.owner = settings?.owner ?? "";
    this.repo = settings?.repo ?? "";
    this.apiBase = (settings?.baseUrl || "https://api.github.com").replace(
      /\/$/,
      ""
    );
    this.workflowRef = (workflowRef ?? "").trim();
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "TestPlanIt-Execution/1.0",
    };
  }

  private get repoApi() {
    return `${this.apiBase}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`;
  }

  /** Web origin for links: api.github.com → github.com; GHES `/api/v3` → host. */
  private get webBase(): string {
    if (this.apiBase === "https://api.github.com") return "https://github.com";
    return this.apiBase.replace(/\/api\/v3$/, "");
  }

  private get isGitHubDotCom(): boolean {
    return this.apiBase === "https://api.github.com";
  }

  private workflowPathOrId(): string {
    return encodeURIComponent(this.workflowRef);
  }

  workflowPageUrl(): string {
    const file = this.workflowRef;
    if (/^\d+$/.test(file) || !file) {
      return `${this.webBase}/${this.owner}/${this.repo}/actions`;
    }
    const name = file.split("/").pop() ?? file;
    return `${this.webBase}/${this.owner}/${this.repo}/actions/workflows/${encodeURIComponent(name)}`;
  }

  async dispatch(req: DispatchRequest): Promise<DispatchResult> {
    if (!this.workflowRef) {
      throw new DispatchError(
        "No workflow is configured for this target",
        "INPUTS"
      );
    }
    const ref = req.ref ?? (await this.defaultBranch());
    const url = `${this.repoApi}/actions/workflows/${this.workflowPathOrId()}/dispatches${
      this.isGitHubDotCom ? "?return_run_details=true" : ""
    }`;
    let response: CiResponse;
    try {
      response = await ciRequest(url, {
        method: "POST",
        headers: { ...this.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ ref, inputs: req.inputs }),
      });
    } catch (err) {
      throw wrap(err);
    }
    if (
      response.status === 204 ||
      response.status === 200 ||
      response.status === 201
    ) {
      const parsed = response.json<{
        workflow_run_id?: number;
        run_url?: string;
        html_url?: string;
      }>();
      const result: DispatchResult = { ref };
      if (parsed?.workflow_run_id != null) {
        result.externalRunId = String(parsed.workflow_run_id);
        result.externalUrl =
          parsed.html_url ??
          `${this.webBase}/${this.owner}/${this.repo}/actions/runs/${parsed.workflow_run_id}`;
      } else {
        result.externalUrl = this.workflowPageUrl();
      }
      return result;
    }
    throw this.mapError(response, "dispatch");
  }

  /**
   * Adopt the single workflow_dispatch run created on the branch between
   * `since` and `until` (GitHub answers a dispatch with 204 and no run id).
   * Returns null when there is none or more than one, so a later manual
   * dispatch outside the window can never be mistaken for ours.
   */
  async findRunCreatedAfter(
    ref: string | null,
    since: Date,
    until?: Date
  ): Promise<{ externalRunId: string; externalUrl?: string } | null> {
    if (!this.workflowRef) return null;
    const created = until
      ? `${since.toISOString()}..${until.toISOString()}`
      : `>=${since.toISOString()}`;
    const params = new URLSearchParams({
      event: "workflow_dispatch",
      created,
      per_page: "5",
    });
    if (ref) params.set("branch", ref);
    let response: CiResponse;
    try {
      response = await ciRequest(
        `${this.repoApi}/actions/workflows/${this.workflowPathOrId()}/runs?${params}`,
        { headers: this.headers }
      );
    } catch {
      return null;
    }
    const parsed = response.json<{ workflow_runs?: GitHubRun[] }>();
    const runs = parsed?.workflow_runs ?? [];
    if (runs.length !== 1) return null;
    return { externalRunId: String(runs[0].id), externalUrl: runs[0].html_url };
  }

  async getStatus(externalRunId: string): Promise<ExternalStatus> {
    let response: CiResponse;
    try {
      response = await ciRequest(
        `${this.repoApi}/actions/runs/${encodeURIComponent(externalRunId)}`,
        { headers: this.headers }
      );
    } catch (err) {
      throw wrap(err);
    }
    if (!response.ok) throw this.mapError(response, "status");
    const run = response.json<GitHubRun>();
    return mapGitHubStatus(run?.status, run?.conclusion, run?.html_url);
  }

  async cancel(externalRunId: string): Promise<void> {
    try {
      await ciRequest(
        `${this.repoApi}/actions/runs/${encodeURIComponent(externalRunId)}/cancel`,
        { method: "POST", headers: this.headers }
      );
    } catch {
      // best-effort
    }
  }

  async listWorkflows(): Promise<WorkflowChoice[]> {
    const out: WorkflowChoice[] = [];
    for (let page = 1; page <= 5; page++) {
      let response: CiResponse;
      try {
        response = await ciRequest(
          `${this.repoApi}/actions/workflows?per_page=100&page=${page}`,
          { headers: this.headers }
        );
      } catch (err) {
        throw wrap(err);
      }
      if (!response.ok) throw this.mapError(response, "workflows");
      const parsed = response.json<{ workflows?: GitHubWorkflow[] }>();
      const batch = parsed?.workflows ?? [];
      for (const w of batch) {
        out.push({ id: String(w.id), name: w.name, path: w.path });
      }
      if (batch.length < 100) break;
    }
    return out;
  }

  async testDispatchCapability(
    workflowRef?: string | null
  ): Promise<DispatchCapability> {
    const ref = (workflowRef ?? this.workflowRef).trim();
    const warnings: string[] = [];
    if (!this.token) {
      return {
        ok: false,
        error: "No credential is available for this repository",
        warnings,
      };
    }
    if (!ref) {
      return { ok: false, error: "Choose a workflow file", warnings };
    }
    let response: CiResponse;
    try {
      response = await ciRequest(
        `${this.repoApi}/actions/workflows/${encodeURIComponent(ref)}`,
        { headers: this.headers }
      );
    } catch (err) {
      return { ok: false, error: wrap(err).message, warnings };
    }
    if (!response.ok) {
      return {
        ok: false,
        error: this.mapError(response, "workflow").message,
        warnings,
      };
    }
    const workflow = response.json<GitHubWorkflow>();
    const scopes = response.headers.get("x-oauth-scopes");
    if (scopes != null) {
      const list = scopes.split(",").map((s) => s.trim());
      if (!list.includes("workflow") && !list.includes("repo")) {
        warnings.push(
          "The token does not carry the `workflow` scope; GitHub may refuse to start the workflow."
        );
      }
    }
    if (workflow?.state && workflow.state !== "active") {
      warnings.push(`The workflow is ${workflow.state}, not active.`);
    }

    let declaredInputs: string[] | undefined;
    if (workflow?.path) {
      const content = await this.fetchFile(workflow.path);
      if (content != null) {
        const parsed = parseWorkflowDispatch(content);
        if (!parsed.hasWorkflowDispatch) {
          return {
            ok: false,
            error:
              "The workflow has no `workflow_dispatch` trigger, so TestPlanIt cannot start it.",
            warnings,
            declaredInputs: parsed.inputs,
          };
        }
        declaredInputs = parsed.inputs;
        const missing = Object.values(RESERVED_INPUT_KEYS).filter(
          (k) => !parsed.inputs.includes(k)
        );
        if (missing.length > 0) {
          warnings.push(
            `The workflow does not declare these inputs under workflow_dispatch.inputs, and GitHub rejects undeclared inputs: ${missing.join(", ")}.`
          );
        }
      }
    }
    return { ok: true, warnings, declaredInputs };
  }

  private async fetchFile(path: string): Promise<string | null> {
    try {
      const response = await ciRequest(
        `${this.repoApi}/contents/${path.split("/").map(encodeURIComponent).join("/")}`,
        { headers: this.headers }
      );
      if (!response.ok) return null;
      const parsed = response.json<{ content?: string; encoding?: string }>();
      if (!parsed?.content) return null;
      if (parsed.encoding === "base64") {
        return Buffer.from(
          parsed.content.replace(/\n/g, ""),
          "base64"
        ).toString("utf8");
      }
      return parsed.content;
    } catch {
      return null;
    }
  }

  private async defaultBranch(): Promise<string> {
    let response: CiResponse;
    try {
      response = await ciRequest(this.repoApi, { headers: this.headers });
    } catch (err) {
      throw wrap(err);
    }
    if (!response.ok) throw this.mapError(response, "repository");
    const parsed = response.json<{ default_branch?: string }>();
    return parsed?.default_branch ?? "main";
  }

  private mapError(response: CiResponse, what: string): DispatchError {
    const detail = response.json<{ message?: string }>()?.message;
    switch (response.status) {
      case 401:
        return new DispatchError("GitHub rejected the token (401)", "AUTH");
      case 403:
        return new DispatchError(
          detail
            ? `GitHub refused (403): ${detail}`
            : "GitHub refused the request (403): the token needs the `workflow` scope or Actions read/write",
          "AUTH"
        );
      case 404:
        return new DispatchError(
          `GitHub could not find the ${what} (404): check the repository, the workflow file, and that the token can see them`,
          "NOT_FOUND"
        );
      case 422:
        return new DispatchError(
          detail
            ? `GitHub rejected the dispatch (422): ${detail}`
            : "GitHub rejected the dispatch (422): the workflow must declare every input under workflow_dispatch.inputs and the ref must exist",
          "INPUTS"
        );
      default:
        return new DispatchError(
          `GitHub returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
          "PROVIDER"
        );
    }
  }
}

function wrap(err: unknown): DispatchError {
  if (err instanceof DispatchError) return err;
  if (err instanceof CiRequestError) {
    return new DispatchError(
      err.message,
      err.code === "BLOCKED" ? "BLOCKED" : "NETWORK"
    );
  }
  return new DispatchError(
    err instanceof Error ? err.message : "Request failed",
    "NETWORK"
  );
}

export function mapGitHubStatus(
  status: string | undefined,
  conclusion: string | null | undefined,
  url?: string
): ExternalStatus {
  const raw = [status, conclusion].filter(Boolean).join("/") || undefined;
  switch (status) {
    case "queued":
    case "waiting":
    case "requested":
    case "pending":
      return { state: "queued", url, raw };
    case "in_progress":
      return { state: "in_progress", url, raw };
    case "completed": {
      const map: Record<string, ExternalStatus["conclusion"]> = {
        success: "success",
        failure: "failure",
        cancelled: "cancelled",
        skipped: "skipped",
        timed_out: "timed_out",
      };
      return {
        state: "completed",
        conclusion: (conclusion && map[conclusion]) || "other",
        url,
        raw,
      };
    }
    default:
      return { state: "unknown", url, raw };
  }
}

/**
 * Minimal, indentation-based read of a workflow file: does it have a
 * `workflow_dispatch` trigger, and which `inputs` keys does it declare? Good
 * enough for a warning; the authoritative answer is GitHub's 422.
 */
export function parseWorkflowDispatch(yaml: string): {
  hasWorkflowDispatch: boolean;
  inputs: string[];
} {
  const lines = yaml.split(/\r?\n/);
  const inputs: string[] = [];
  let hasWorkflowDispatch = false;
  let dispatchIndent: number | null = null;
  let inputsIndent: number | null = null;
  let inputKeyIndent: number | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const text = line.trim();

    if (/^workflow_dispatch\s*:/.test(text) || text === "- workflow_dispatch") {
      hasWorkflowDispatch = true;
      dispatchIndent = indent;
      inputsIndent = null;
      inputKeyIndent = null;
      continue;
    }
    if (dispatchIndent != null && indent <= dispatchIndent) {
      // Left the workflow_dispatch block.
      dispatchIndent = null;
      inputsIndent = null;
      inputKeyIndent = null;
    }
    if (
      dispatchIndent != null &&
      inputsIndent == null &&
      /^inputs\s*:/.test(text)
    ) {
      inputsIndent = indent;
      continue;
    }
    if (inputsIndent != null) {
      if (indent <= inputsIndent) {
        inputsIndent = null;
        inputKeyIndent = null;
        continue;
      }
      if (inputKeyIndent == null) inputKeyIndent = indent;
      if (indent === inputKeyIndent) {
        const m = text.match(/^([A-Za-z0-9_.-]+)\s*:/);
        if (m) inputs.push(m[1]);
      }
    }
  }
  // `on: [push, workflow_dispatch]` flow-style list.
  if (
    !hasWorkflowDispatch &&
    /\bon\s*:\s*\[[^\]]*workflow_dispatch/.test(yaml)
  ) {
    hasWorkflowDispatch = true;
  }
  return { hasWorkflowDispatch, inputs };
}
