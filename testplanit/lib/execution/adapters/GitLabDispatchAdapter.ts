import { ciRequest, CiRequestError, type CiResponse } from "../http";
import type {
  DispatchCapability,
  DispatchRequest,
  DispatchResult,
  ExternalStatus,
} from "../types";
import { CiDispatchAdapter, DispatchError } from "./CiDispatchAdapter";

interface GitLabPipeline {
  id: number;
  web_url?: string;
  status?: string;
}

/**
 * GitLab CI pipelines. Two credentials are possible:
 *   - a pipeline trigger token (`triggerToken`) → POST /trigger/pipeline with
 *     `variables[K]=V`; cheap and scoped, but cannot read pipeline status;
 *   - a personal/project access token with `api` scope
 *     (`personalAccessToken`) → POST /pipeline; can poll and cancel.
 * When both are present the trigger token starts the pipeline and the access
 * token reads it.
 */
export class GitLabDispatchAdapter extends CiDispatchAdapter {
  private readonly accessToken: string;
  private readonly triggerToken: string;
  private readonly projectPath: string;
  private readonly baseUrl: string;

  constructor(
    credentials: Record<string, string>,
    settings: Record<string, string> | null | undefined
  ) {
    super();
    this.accessToken = credentials.personalAccessToken ?? "";
    this.triggerToken = credentials.triggerToken ?? "";
    this.projectPath = settings?.projectPath ?? "";
    this.baseUrl = (settings?.baseUrl || "https://gitlab.com").replace(
      /\/$/,
      ""
    );
  }

  get supportsStatusPolling(): boolean {
    return Boolean(this.accessToken);
  }

  private get project() {
    return /^\d+$/.test(this.projectPath)
      ? this.projectPath
      : encodeURIComponent(this.projectPath);
  }

  private get api() {
    return `${this.baseUrl}/api/v4/projects/${this.project}`;
  }

  private get authHeaders(): Record<string, string> {
    return this.accessToken
      ? {
          "PRIVATE-TOKEN": this.accessToken,
          "User-Agent": "TestPlanIt-Execution/1.0",
        }
      : { "User-Agent": "TestPlanIt-Execution/1.0" };
  }

  async dispatch(req: DispatchRequest): Promise<DispatchResult> {
    const ref = req.ref ?? (await this.defaultBranch());
    let response: CiResponse;
    try {
      if (this.triggerToken) {
        const form = new URLSearchParams();
        form.set("token", this.triggerToken);
        form.set("ref", ref);
        for (const [k, v] of Object.entries(req.inputs)) {
          form.set(`variables[${k}]`, v);
        }
        response = await ciRequest(`${this.api}/trigger/pipeline`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "TestPlanIt-Execution/1.0",
          },
          body: form.toString(),
        });
      } else if (this.accessToken) {
        response = await ciRequest(`${this.api}/pipeline`, {
          method: "POST",
          headers: { ...this.authHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({
            ref,
            variables: Object.entries(req.inputs).map(([key, value]) => ({
              key,
              value,
              variable_type: "env_var",
            })),
          }),
        });
      } else {
        throw new DispatchError("No GitLab credential is configured", "AUTH");
      }
    } catch (err) {
      throw wrap(err);
    }
    if (!response.ok) throw this.mapError(response, "pipeline");
    const pipeline = response.json<GitLabPipeline>();
    if (!pipeline?.id) {
      throw new DispatchError(
        "GitLab accepted the request but returned no pipeline",
        "PROVIDER"
      );
    }
    return {
      ref,
      externalRunId: String(pipeline.id),
      externalUrl:
        pipeline.web_url ??
        `${this.baseUrl}/${this.projectPath}/-/pipelines/${pipeline.id}`,
    };
  }

  async getStatus(externalRunId: string): Promise<ExternalStatus> {
    if (!this.accessToken) {
      return { state: "unknown", raw: "no access token" };
    }
    let response: CiResponse;
    try {
      response = await ciRequest(
        `${this.api}/pipelines/${encodeURIComponent(externalRunId)}`,
        { headers: this.authHeaders }
      );
    } catch (err) {
      throw wrap(err);
    }
    if (!response.ok) throw this.mapError(response, "pipeline");
    const pipeline = response.json<GitLabPipeline>();
    return mapGitLabStatus(pipeline?.status, pipeline?.web_url);
  }

  async cancel(externalRunId: string): Promise<void> {
    if (!this.accessToken) return;
    try {
      await ciRequest(
        `${this.api}/pipelines/${encodeURIComponent(externalRunId)}/cancel`,
        { method: "POST", headers: this.authHeaders }
      );
    } catch {
      // best-effort
    }
  }

  async testDispatchCapability(): Promise<DispatchCapability> {
    const warnings: string[] = [];
    if (!this.accessToken && !this.triggerToken) {
      return {
        ok: false,
        error: "No GitLab credential is configured",
        warnings,
      };
    }
    if (!this.projectPath) {
      return {
        ok: false,
        error: "The repository has no project path",
        warnings,
      };
    }
    if (!this.accessToken) {
      warnings.push(
        "Only a trigger token is configured: pipelines can be started but their status cannot be read."
      );
      return { ok: true, warnings };
    }
    let response: CiResponse;
    try {
      response = await ciRequest(this.api, { headers: this.authHeaders });
    } catch (err) {
      return { ok: false, error: wrap(err).message, warnings };
    }
    if (!response.ok) {
      return {
        ok: false,
        error: this.mapError(response, "project").message,
        warnings,
      };
    }
    try {
      const self = await ciRequest(
        `${this.baseUrl}/api/v4/personal_access_tokens/self`,
        {
          headers: this.authHeaders,
        }
      );
      const parsed = self.json<{ scopes?: string[] }>();
      if (self.ok && parsed?.scopes && !parsed.scopes.includes("api")) {
        warnings.push(
          "The access token lacks the `api` scope; GitLab will refuse to create pipelines with it."
        );
      }
    } catch {
      // Project access tokens cannot read /self; not an error.
    }
    return { ok: true, warnings };
  }

  private async defaultBranch(): Promise<string> {
    if (!this.accessToken) return "main";
    let response: CiResponse;
    try {
      response = await ciRequest(this.api, { headers: this.authHeaders });
    } catch (err) {
      throw wrap(err);
    }
    if (!response.ok) throw this.mapError(response, "project");
    return (
      response.json<{ default_branch?: string }>()?.default_branch ?? "main"
    );
  }

  private mapError(response: CiResponse, what: string): DispatchError {
    const body = response.json<{ message?: unknown; error?: unknown }>();
    const detail =
      typeof body?.message === "string"
        ? body.message
        : body?.message && typeof body.message === "object"
          ? JSON.stringify(body.message)
          : typeof body?.error === "string"
            ? body.error
            : undefined;
    switch (response.status) {
      case 401:
        return new DispatchError("GitLab rejected the token (401)", "AUTH");
      case 403:
        return new DispatchError(
          detail
            ? `GitLab refused (403): ${detail}`
            : "GitLab refused the request (403)",
          "AUTH"
        );
      case 404:
        return new DispatchError(
          `GitLab could not find the ${what} (404): check the project path and the token`,
          "NOT_FOUND"
        );
      case 400:
        return new DispatchError(
          detail
            ? `GitLab rejected the request (400): ${detail}`
            : "GitLab rejected the request (400)",
          "INPUTS"
        );
      default:
        return new DispatchError(
          `GitLab returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
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

export function mapGitLabStatus(
  status: string | undefined,
  url?: string
): ExternalStatus {
  switch (status) {
    case "created":
    case "waiting_for_resource":
    case "preparing":
    case "pending":
    case "scheduled":
    case "manual":
      return { state: "queued", url, raw: status };
    case "running":
      return { state: "in_progress", url, raw: status };
    case "success":
      return { state: "completed", conclusion: "success", url, raw: status };
    case "failed":
      return { state: "completed", conclusion: "failure", url, raw: status };
    case "canceled":
    case "canceling":
      return { state: "completed", conclusion: "cancelled", url, raw: status };
    case "skipped":
      return { state: "completed", conclusion: "skipped", url, raw: status };
    default:
      return { state: "unknown", url, raw: status };
  }
}
