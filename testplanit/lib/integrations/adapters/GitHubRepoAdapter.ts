import {
  GitRepoAdapter, ListFilesResult, RepoFileEntry, TestConnectionResult
} from "./GitRepoAdapter";

export class GitHubRepoAdapter extends GitRepoAdapter {
  private personalAccessToken: string;
  private owner: string;
  private repo: string;

  constructor(
    credentials: Record<string, string>,
    settings: Record<string, string> | null | undefined
  ) {
    super();
    this.personalAccessToken = credentials.personalAccessToken;
    this.owner = settings?.owner ?? "";
    this.repo = settings?.repo ?? "";
  }

  private get authHeaders() {
    return {
      Authorization: `token ${this.personalAccessToken}`,
      Accept: "application/vnd.github.v3+json",
    };
  }

  async getDefaultBranch(): Promise<string> {
    const data = await this.makeRequest<any>(
      `https://api.github.com/repos/${this.owner}/${this.repo}`,
      { headers: this.authHeaders }
    );
    return data.default_branch;
  }

  async listAllFiles(branch: string): Promise<ListFilesResult> {
    // Step 1: Get branch SHA
    const branchData = await this.makeRequest<any>(
      `https://api.github.com/repos/${this.owner}/${this.repo}/branches/${encodeURIComponent(branch)}`,
      { headers: this.authHeaders }
    );
    const treeSha: string = branchData.commit.commit.tree.sha;

    // Step 2: Fetch recursive tree
    const treeData = await this.makeRequest<any>(
      `https://api.github.com/repos/${this.owner}/${this.repo}/git/trees/${treeSha}?recursive=1`,
      { headers: this.authHeaders }
    );

    if (treeData.truncated) {
      console.warn(
        `[GitHubRepoAdapter] Tree truncated for ${this.owner}/${this.repo} — results may be incomplete (>100k files or >7MB)`
      );
    }

    const files: RepoFileEntry[] = (treeData.tree ?? [])
      .filter((item: any) => item.type === "blob")
      .map((item: any) => ({
        path: item.path as string,
        size: (item.size as number) ?? 0,
        type: "file" as const,
      }));

    return { files, truncated: treeData.truncated === true };
  }

  async getFileContent(path: string, branch: string): Promise<string> {
    const data = await this.makeRequest<any>(
      `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
      { headers: this.authHeaders }
    );
    return Buffer.from(data.content, "base64").toString("utf-8");
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      const data = await this.makeRequest<any>(
        `https://api.github.com/repos/${this.owner}/${this.repo}`,
        { headers: this.authHeaders }
      );
      return { success: true, defaultBranch: data.default_branch };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
