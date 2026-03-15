import {
  GitRepoAdapter, ListFilesResult, RepoFileEntry, TestConnectionResult
} from "./GitRepoAdapter";

export class AzureDevOpsRepoAdapter extends GitRepoAdapter {
  private personalAccessToken: string;
  private organizationUrl: string; // e.g. https://dev.azure.com/myorg
  private project: string;
  private repositoryId: string; // repo name or ID

  constructor(
    credentials: Record<string, string>,
    settings: Record<string, string> | null | undefined
  ) {
    super();
    this.personalAccessToken = credentials.personalAccessToken;
    this.organizationUrl = (settings?.organizationUrl ?? "").replace(/\/$/, "");
    if (this.organizationUrl) {
      this.organizationUrl = this.sanitizeUrl(this.organizationUrl);
    }
    this.project = settings?.project ?? "";
    this.repositoryId = settings?.repositoryId ?? "";
  }

  private get authHeaders() {
    const encoded = Buffer.from(`:${this.personalAccessToken}`).toString(
      "base64"
    );
    return { Authorization: `Basic ${encoded}` };
  }

  async getDefaultBranch(): Promise<string> {
    const data = await this.makeRequest<any>(
      `${this.organizationUrl}/${encodeURIComponent(this.project)}/_apis/git/repositories/${encodeURIComponent(this.repositoryId)}?api-version=7.0`,
      { headers: this.authHeaders }
    );
    // defaultBranch is like "refs/heads/main"
    return (
      (data.defaultBranch as string)?.replace("refs/heads/", "") ?? "main"
    );
  }

  async listAllFiles(branch: string): Promise<ListFilesResult> {
    const data = await this.makeRequest<any>(
      `${this.organizationUrl}/${encodeURIComponent(this.project)}/_apis/git/repositories/${encodeURIComponent(this.repositoryId)}/items?recursionLevel=Full&versionDescriptor.version=${encodeURIComponent(branch)}&versionDescriptor.versionType=branch&api-version=7.0`,
      { headers: this.authHeaders }
    );

    const files: RepoFileEntry[] = (data.value ?? [])
      .filter((item: any) => item.gitObjectType === "blob")
      .map((item: any) => ({
        path: (item.path as string).replace(/^\//, ""), // Remove leading slash
        size: (item.size as number) ?? 0,
        type: "file" as const,
      }));

    return { files };
  }

  async getFileContent(path: string, branch: string): Promise<string> {
    const url = `${this.organizationUrl}/${encodeURIComponent(this.project)}/_apis/git/repositories/${encodeURIComponent(this.repositoryId)}/items?path=${encodeURIComponent(path)}&versionDescriptor.version=${encodeURIComponent(branch)}&versionDescriptor.versionType=branch&api-version=7.0`;

    return this.executeWithRetry(async () => {
      await this.applyRateLimit();

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.requestTimeout
      );

      try {
        const safeUrl = this.sanitizeUrl(url);
        const response = await fetch(safeUrl, {
          headers: this.authHeaders,
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(
            `Azure DevOps HTTP ${response.status}: ${text.slice(0, 200)}`
          );
        }

        return await response.text();
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }

  async testConnection(): Promise<TestConnectionResult> {
    try {
      // Test with repository API (Code Read scope required — validates correct PAT scope)
      await this.makeRequest<any>(
        `${this.organizationUrl}/${encodeURIComponent(this.project)}/_apis/git/repositories/${encodeURIComponent(this.repositoryId)}?api-version=7.0`,
        { headers: this.authHeaders }
      );
      const defaultBranch = await this.getDefaultBranch();
      return { success: true, defaultBranch };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
