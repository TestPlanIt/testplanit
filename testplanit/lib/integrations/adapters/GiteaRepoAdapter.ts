/**
 * Git repository adapter for Gitea, Forgejo, and Gogs.
 * All three platforms expose a compatible /api/v1/ REST API.
 */
import {
  GitRepoAdapter, ListFilesResult, RepoFileEntry, TestConnectionResult
} from "./GitRepoAdapter";

const MAX_FILES = 10000;

export class GiteaRepoAdapter extends GitRepoAdapter {
  private personalAccessToken: string;
  private owner: string;
  private repo: string;
  private baseUrl: string;

  constructor(
    credentials: Record<string, string>,
    settings: Record<string, string> | null | undefined
  ) {
    super();
    this.personalAccessToken = credentials.personalAccessToken;
    this.owner = settings?.owner ?? "";
    this.repo = settings?.repo ?? "";
    this.baseUrl = (settings?.baseUrl ?? "").replace(/\/$/, "");
    this.baseUrl = this.sanitizeUrl(this.baseUrl);
  }

  private get authHeaders() {
    return {
      Authorization: `token ${this.personalAccessToken}`,
      Accept: "application/json",
    };
  }

  async getDefaultBranch(): Promise<string> {
    const data = await this.makeRequest<any>(
      `${this.baseUrl}/api/v1/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`,
      { headers: this.authHeaders }
    );
    return data.default_branch;
  }

  async listAllFiles(branch: string): Promise<ListFilesResult> {
    // Step 1: Resolve branch to tree SHA
    const branchData = await this.makeRequest<any>(
      `${this.baseUrl}/api/v1/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/branches/${encodeURIComponent(branch)}`,
      { headers: this.authHeaders }
    );
    const treeSha: string = branchData.commit?.commit?.tree?.sha
      ?? branchData.commit?.id
      ?? branchData.commit?.sha;

    if (!treeSha) {
      throw new Error("Could not resolve branch to a tree SHA");
    }

    // Step 2: Fetch recursive tree (paginated)
    const files: RepoFileEntry[] = [];
    let page = 1;
    let truncated = false;

    while (files.length < MAX_FILES) {
      const treeData = await this.makeRequest<any>(
        `${this.baseUrl}/api/v1/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/git/trees/${treeSha}?recursive=true&per_page=100&page=${page}`,
        { headers: this.authHeaders }
      );

      if (treeData.truncated) {
        truncated = true;
      }

      const entries: any[] = treeData.tree ?? [];
      if (entries.length === 0) break;

      const fileEntries = entries
        .filter((item: any) => item.type === "blob")
        .map((item: any) => ({
          path: item.path as string,
          size: (item.size as number) ?? 0,
          type: "file" as const,
        }));
      files.push(...fileEntries);

      // Gitea returns total_count when paginated; stop when we've got all pages
      const totalCount = treeData.total_count;
      if (totalCount !== undefined && files.length >= totalCount) break;

      // If this page returned fewer than requested, we're done
      if (entries.length < 100) break;

      page++;
    }

    return { files: files.slice(0, MAX_FILES), truncated };
  }

  async getFileContent(path: string, branch: string): Promise<string> {
    // Gitea raw endpoint returns file content directly as text
    return this.makeTextRequest(
      `${this.baseUrl}/api/v1/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/raw/${path}?ref=${encodeURIComponent(branch)}`,
      { headers: this.authHeaders }
    );
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      const data = await this.makeRequest<any>(
        `${this.baseUrl}/api/v1/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`,
        { headers: this.authHeaders }
      );
      return { success: true, defaultBranch: data.default_branch };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
