import {
  GitRepoAdapter, ListFilesResult, RepoFileEntry, TestConnectionResult
} from "./GitRepoAdapter";

const MAX_FILES = 10000;

export class BitbucketRepoAdapter extends GitRepoAdapter {
  private email: string;
  private apiToken: string;
  private workspace: string;
  private repoSlug: string;

  constructor(
    credentials: Record<string, string>,
    settings: Record<string, string> | null | undefined
  ) {
    super();
    // Support both new (email/apiToken) and legacy (username/appPassword) credentials
    this.email = credentials.email ?? credentials.username;
    this.apiToken = credentials.apiToken ?? credentials.appPassword;
    this.workspace = settings?.workspace ?? "";
    this.repoSlug = settings?.repoSlug ?? "";
  }

  private get authHeaders() {
    const encoded = Buffer.from(
      `${this.email}:${this.apiToken}`
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
    return this.listFilesInPaths(branch, [""]);
  }

  /**
   * Path-scoped listing: only fetches files under the given base paths,
   * avoiding a full-repo scan when the user specifies path patterns.
   */
  async listFilesInPaths(
    branch: string,
    basePaths: string[],
    onProgress?: (filesFound: number) => void
  ): Promise<ListFilesResult> {
    const files: RepoFileEntry[] = [];
    const seen = new Set<string>();
    const MAX_DEPTH = 10;
    // Deduplicate and normalise paths; empty string = repo root
    const seeds = basePaths.length > 0 ? basePaths : [""];
    const queue: string[] = [...seeds];

    while (queue.length > 0 && files.length < MAX_FILES) {
      const path = queue.shift()!;
      let url: string | null = `https://api.bitbucket.org/2.0/repositories/${this.workspace}/${this.repoSlug}/src/${encodeURIComponent(branch)}/${path}?pagelen=100&max_depth=${MAX_DEPTH}`;

      while (url && files.length < MAX_FILES) {
        const data: any = await this.makeRequest<any>(url, {
          headers: this.authHeaders,
        });
        for (const item of data.values ?? []) {
          if (item.type === "commit_file") {
            const filePath = item.path as string;
            if (!seen.has(filePath)) {
              seen.add(filePath);
              files.push({
                path: filePath,
                size: (item.size as number) ?? 0,
                type: "file",
              });
            }
          } else if (item.type === "commit_directory") {
            // Directories still appearing means they're deeper than max_depth
            queue.push(item.path as string);
          }
        }
        url = data.next ?? null; // Bitbucket provides full next URL
        onProgress?.(files.length);
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
