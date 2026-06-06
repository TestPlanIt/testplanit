/**
 * Hand-rolled Okta REST API client for the SCIM dev-tenant E2E.
 *
 * Used exclusively by `e2e/scim/okta-lifecycle.test.ts`. The lifecycle
 * test drives a real Okta dev tenant through a 9-step provisioning
 * sequence and asserts the resulting TestPlanIt DB state via Prisma.
 *
 * Why hand-rolled instead of the official Okta Node SDK:
 *
 *   - The lifecycle exercises ~9 REST calls (user CRUD + group CRUD +
 *     app-assignment). The official SDK pulls in ~80 transitive deps to
 *     surface ~500 endpoints; the cost is not worth it for an E2E.
 *   - Node 22+ ships `fetch` natively, so zero new lockfile entries.
 *   - A small wrapper is trivial to mock with `vi.stubGlobal("fetch", ...)`.
 *
 * Authentication:
 *
 *   Okta API tokens use the `SSWS` scheme. THIS IS NOT `Bearer`.
 *   `Bearer` is for OAuth2 access tokens, which this E2E does not use.
 *
 *       Authorization: SSWS <OKTA_API_TOKEN>
 *
 * Rate limits:
 *
 *   On HTTP 429 the client reads `Retry-After` (seconds), sleeps for
 *   that long, and retries ONCE. A second 429 throws to avoid an
 *   unbounded retry loop. Tenant-wide throttling beyond a single retry
 *   is the operator's problem, not the client's.
 *
 * Error scrubbing:
 *
 *   Non-2xx responses throw `Error("Okta API <status> <path>: <body>")`.
 *   The Authorization header value is NEVER echoed into the error
 *   message — only the path, the response status, and the response body
 *   text. Test failures may surface the tenant URL (not a secret) but
 *   never the SSWS token (which IS a secret).
 *
 * Pagination:
 *
 *   Okta uses cursor-based pagination via the RFC 5988 `Link` header.
 *   `listUsers` / `listGroups` follow `rel="next"` until absent.
 */

export interface OktaUser {
  id: string;
  status: string;
  profile: {
    login: string;
    firstName: string;
    lastName: string;
    email: string;
    [key: string]: unknown;
  };
}

export interface OktaGroup {
  id: string;
  profile: {
    name: string;
    description?: string;
    [key: string]: unknown;
  };
}

type FetchInit = RequestInit & {
  query?: Record<string, string | undefined>;
};

function buildUrl(
  orgUrl: string,
  path: string,
  query?: Record<string, string | undefined>,
): string {
  if (!query) return `${orgUrl}${path}`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, value);
  }
  const qs = params.toString();
  return qs.length === 0 ? `${orgUrl}${path}` : `${orgUrl}${path}?${qs}`;
}

/**
 * Extract the URL whose `rel` parameter equals `"next"` from a comma-separated
 * RFC 5988 Link header. Returns null when the header is null or no `next`
 * relation is present.
 *
 *     Link: <https://example.okta.com/api/v1/users?after=abc>; rel="next",
 *           <https://example.okta.com/api/v1/users>; rel="self"
 */
export function parseLinkHeader(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",");
  for (const part of parts) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/i);
    if (match) return match[1];
  }
  return null;
}

export class OktaClient {
  constructor(
    private readonly orgUrl: string,
    private readonly apiToken: string,
  ) {}

  private async request<T>(
    path: string,
    init: FetchInit = {},
    isRetry = false,
  ): Promise<{ body: T; headers: Headers }> {
    const { query, ...rest } = init;
    const url = path.startsWith("http")
      ? path
      : buildUrl(this.orgUrl, path, query);
    const res = await fetch(url, {
      ...rest,
      headers: {
        ...(rest.headers ?? {}),
        Authorization: `SSWS ${this.apiToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });

    if (res.status === 429) {
      if (isRetry) {
        const body = await res.text();
        throw new Error(`Okta API 429 ${path}: ${body}`);
      }
      const retryAfterSec = Number(res.headers.get("Retry-After") ?? "5");
      await new Promise((resolve) =>
        setTimeout(resolve, retryAfterSec * 1000),
      );
      return this.request<T>(path, init, true);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Okta API ${res.status} ${path}: ${body}`);
    }

    // 204 No Content (DELETE) returns an empty body; tolerate.
    const text = await res.text();
    const parsed = (text.length === 0 ? {} : JSON.parse(text)) as T;
    return { body: parsed, headers: res.headers };
  }

  private async fetchJson<T>(path: string, init: FetchInit = {}): Promise<T> {
    const { body } = await this.request<T>(path, init);
    return body;
  }

  getUser(userId: string): Promise<OktaUser> {
    return this.fetchJson<OktaUser>(`/api/v1/users/${encodeURIComponent(userId)}`);
  }

  async listUsers(filter?: string): Promise<OktaUser[]> {
    const collected: OktaUser[] = [];
    let pathOrUrl: string = filter
      ? buildUrl(this.orgUrl, "/api/v1/users", { filter })
      : "/api/v1/users";
    // Follow Link rel="next" until exhausted.
    // Cap iterations at 100 pages to prevent runaway loops on a misbehaving tenant.
    for (let page = 0; page < 100; page += 1) {
      const { body, headers } = await this.request<OktaUser[]>(pathOrUrl);
      collected.push(...body);
      const next = parseLinkHeader(headers.get("link") ?? headers.get("Link"));
      if (!next) break;
      pathOrUrl = next;
    }
    return collected;
  }

  updateUser(userId: string, profile: Partial<OktaUser["profile"]>): Promise<OktaUser> {
    return this.fetchJson<OktaUser>(
      `/api/v1/users/${encodeURIComponent(userId)}`,
      {
        method: "POST",
        body: JSON.stringify({ profile }),
      },
    );
  }

  getGroup(groupId: string): Promise<OktaGroup> {
    return this.fetchJson<OktaGroup>(
      `/api/v1/groups/${encodeURIComponent(groupId)}`,
    );
  }

  async listGroups(filter?: string): Promise<OktaGroup[]> {
    const collected: OktaGroup[] = [];
    let pathOrUrl: string = filter
      ? buildUrl(this.orgUrl, "/api/v1/groups", { filter })
      : "/api/v1/groups";
    for (let page = 0; page < 100; page += 1) {
      const { body, headers } = await this.request<OktaGroup[]>(pathOrUrl);
      collected.push(...body);
      const next = parseLinkHeader(headers.get("link") ?? headers.get("Link"));
      if (!next) break;
      pathOrUrl = next;
    }
    return collected;
  }

  createGroup(name: string, description?: string): Promise<OktaGroup> {
    return this.fetchJson<OktaGroup>("/api/v1/groups", {
      method: "POST",
      body: JSON.stringify({ profile: { name, description: description ?? "" } }),
    });
  }

  deleteGroup(groupId: string): Promise<unknown> {
    return this.fetchJson<unknown>(
      `/api/v1/groups/${encodeURIComponent(groupId)}`,
      { method: "DELETE" },
    );
  }

  assignUserToApp(
    appId: string,
    userId: string,
    profile: Record<string, unknown> & { userName: string },
  ): Promise<unknown> {
    return this.fetchJson<unknown>(`/api/v1/apps/${encodeURIComponent(appId)}/users`, {
      method: "POST",
      body: JSON.stringify({
        id: userId,
        scope: "USER",
        credentials: { userName: profile.userName },
        profile,
      }),
    });
  }

  unassignUserFromApp(appId: string, userId: string): Promise<unknown> {
    return this.fetchJson<unknown>(
      `/api/v1/apps/${encodeURIComponent(appId)}/users/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
  }

  assignGroupToApp(appId: string, groupId: string): Promise<unknown> {
    return this.fetchJson<unknown>(
      `/api/v1/apps/${encodeURIComponent(appId)}/groups/${encodeURIComponent(groupId)}`,
      { method: "PUT" },
    );
  }

  unassignGroupFromApp(appId: string, groupId: string): Promise<unknown> {
    return this.fetchJson<unknown>(
      `/api/v1/apps/${encodeURIComponent(appId)}/groups/${encodeURIComponent(groupId)}`,
      { method: "DELETE" },
    );
  }

  addUserToGroup(groupId: string, userId: string): Promise<unknown> {
    return this.fetchJson<unknown>(
      `/api/v1/groups/${encodeURIComponent(groupId)}/users/${encodeURIComponent(userId)}`,
      { method: "PUT" },
    );
  }

  removeUserFromGroup(groupId: string, userId: string): Promise<unknown> {
    return this.fetchJson<unknown>(
      `/api/v1/groups/${encodeURIComponent(groupId)}/users/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
  }

  deactivateUser(userId: string): Promise<unknown> {
    return this.fetchJson<unknown>(
      `/api/v1/users/${encodeURIComponent(userId)}/lifecycle/deactivate`,
      { method: "POST" },
    );
  }

  activateUser(userId: string): Promise<unknown> {
    return this.fetchJson<unknown>(
      `/api/v1/users/${encodeURIComponent(userId)}/lifecycle/activate?sendEmail=false`,
      { method: "POST" },
    );
  }

  deleteUser(userId: string): Promise<unknown> {
    return this.fetchJson<unknown>(
      `/api/v1/users/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
  }
}
