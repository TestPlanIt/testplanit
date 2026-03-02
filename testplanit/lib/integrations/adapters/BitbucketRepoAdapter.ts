import {
  GitRepoAdapter,
  RepoFileEntry,
  ListFilesResult,
  TestConnectionResult,
} from "./GitRepoAdapter";

const MAX_FILES = 10000;

export class BitbucketRepoAdapter extends GitRepoAdapter {
  private username: string;
  private appPassword: string;
  private workspace: string;
  private repoSlug: string;

  constructor(
    credentials: Record<string, string>,
    settings: Record<string, string> | null | undefined
  ) {
    super();
    this.username = credentials.username;
    this.appPassword = credentials.appPassword;
    this.workspace = settings?.workspace ?? "";
    this.repoSlug = settings?.repoSlug ?? "";
  }

  private get authHeaders() {
    const encoded = Buffer.from(
      `${this.username}:${this.appPassword}`
    ).toString("base64");
    return { Authorization: `Basic ${encoded}` };
  }

  async getDefaultBranch(): Promise<string> {
    const data = await this.makeRequest<any>(
      `https://api.bitbucket.org/2.0/repositories/${this.workspace}/${this.repoSlug}`,
      { headers: this.authHeaders }
    );
    return data.mainbranch?.name ?? "main";
  }

  async listAllFiles(branch: string): Promise<ListFilesResult> {
    const files: RepoFileEntry[] = [];
    // Recursive directory traversal via paginated API
    const queue: string[] = [""]; // Empty string = repo root

    while (queue.length > 0 && files.length < MAX_FILES) {
      const path = queue.shift()!;
      let url: string | null = `https://api.bitbucket.org/2.0/repositories/${this.workspace}/${this.repoSlug}/src/${encodeURIComponent(branch)}/${path}?pagelen=100`;

      while (url && files.length < MAX_FILES) {
        const data: any = await this.makeRequest<any>(url, {
          headers: this.authHeaders,
        });
        for (const item of data.values ?? []) {
          if (item.type === "commit_file") {
            files.push({
              path: item.path as string,
              size: (item.size as number) ?? 0,
              type: "file",
            });
          } else if (item.type === "commit_directory") {
            queue.push(item.path as string);
          }
        }
        url = data.next ?? null; // Bitbucket provides full next URL
      }
    }

    return { files: files.slice(0, MAX_FILES) };
  }

  async getFileContent(path: string, branch: string): Promise<string> {
    const url = `https://api.bitbucket.org/2.0/repositories/${this.workspace}/${this.repoSlug}/src/${encodeURIComponent(branch)}/${path}`;

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
            `Bitbucket HTTP ${response.status}: ${text.slice(0, 200)}`
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
      const data = await this.makeRequest<any>(
        `https://api.bitbucket.org/2.0/repositories/${this.workspace}/${this.repoSlug}`,
        { headers: this.authHeaders }
      );
      return { success: true, defaultBranch: data.mainbranch?.name };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
