import { assertSsrfSafeResolved, createPinnedDispatcher } from "~/utils/ssrf";
import {
  GitRepoAdapter,
  ListFilesResult,
  RepoFileEntry,
  TestConnectionResult,
} from "./GitRepoAdapter";

const MAX_FILES = 10000; // Cap to prevent runaway pagination

export class GitLabRepoAdapter extends GitRepoAdapter {
  private personalAccessToken: string;
  private projectPath: string; // numeric ID or "namespace/project"
  private baseUrl: string; // defaults to https://gitlab.com

  constructor(
    credentials: Record<string, string>,
    settings: Record<string, string> | null | undefined
  ) {
    super();
    this.personalAccessToken = credentials.personalAccessToken;
    this.projectPath = settings?.projectPath ?? "";
    this.baseUrl = (settings?.baseUrl ?? "https://gitlab.com").replace(
      /\/$/,
      ""
    );
    this.baseUrl = this.sanitizeUrl(this.baseUrl);
  }

  private get authHeaders() {
    return { "PRIVATE-TOKEN": this.personalAccessToken };
  }

  private get encodedProjectPath() {
    // GitLab accepts numeric ID directly; otherwise URL-encode the path
    return /^\d+$/.test(this.projectPath)
      ? this.projectPath
      : encodeURIComponent(this.projectPath);
  }

  async getDefaultBranch(): Promise<string> {
    const data = await this.makeRequest<any>(
      `${this.baseUrl}/api/v4/projects/${this.encodedProjectPath}`,
      { headers: this.authHeaders }
    );
    return data.default_branch;
  }

  async listAllFiles(branch: string): Promise<ListFilesResult> {
    const files: RepoFileEntry[] = [];
    let page = 1;

    while (files.length < MAX_FILES) {
      const url = `${this.baseUrl}/api/v4/projects/${this.encodedProjectPath}/repository/tree?recursive=true&per_page=100&ref=${encodeURIComponent(branch)}&page=${page}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.requestTimeout
      );
      let dispatcher: ReturnType<typeof createPinnedDispatcher> | undefined;

      let response: Response;
      try {
        const safeUrl = this.sanitizeUrl(url);
        // Validate the resolved IP and pin the connection to it (DNS-rebinding
        // guard). This bespoke pagination loop bypasses the base makeRequest, so
        // the SSRF re-check has to happen here too.
        const pinnedIp = await assertSsrfSafeResolved(safeUrl);
        dispatcher = pinnedIp ? createPinnedDispatcher(pinnedIp) : undefined;
        await this.applyRateLimit();
        const init: RequestInit & { dispatcher?: unknown } = {
          headers: this.authHeaders,
          signal: controller.signal,
        };
        if (dispatcher) init.dispatcher = dispatcher;
        response = await fetch(safeUrl, init);
      } finally {
        clearTimeout(timeoutId);
        dispatcher?.close().catch(() => {});
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `GitLab HTTP ${response.status}: ${text.slice(0, 200)}`
        );
      }

      const items: any[] = await response.json();
      const fileItems = items
        .filter((item) => item.type === "blob")
        .map((item) => ({
          path: item.path as string,
          size: 0, // GitLab recursive tree does not return file sizes
          type: "file" as const,
        }));
      files.push(...fileItems);

      const nextPage = response.headers.get("X-Next-Page");
      if (!nextPage) break;
      page = parseInt(nextPage, 10);
    }

    return { files: files.slice(0, MAX_FILES) };
  }

  async getFileContent(path: string, branch: string): Promise<string> {
    const url = `${this.baseUrl}/api/v4/projects/${this.encodedProjectPath}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(branch)}`;
    return this.makeTextRequest(url, { headers: this.authHeaders });
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      const data = await this.makeRequest<any>(
        `${this.baseUrl}/api/v4/projects/${this.encodedProjectPath}`,
        { headers: this.authHeaders }
      );
      return { success: true, defaultBranch: data.default_branch };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
