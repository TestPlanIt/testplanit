import { RefreshTokenRevokedError } from "../errors";
import { FIXED_TRACKER_STATUSES } from "../fixedTrackerStatuses";
import {
  GITHUB_CLOSE_REASON_STATUSES,
  githubIssueStatus,
} from "../githubIssueStatus";
import { parseIssueTemplates } from "../issueTemplateParser";
import type { IssueTemplateSet } from "../issueTemplates";
import { tiptapToMarkdown } from "~/lib/tiptap/tiptapToMarkdown";
import { calendarDateToInstant } from "~/utils/calendarDate";
import { BaseAdapter } from "./BaseAdapter";
import {
  AuthenticationData,
  CreateIssueData,
  CreateIssueField,
  CreateIssueMetadata,
  ExternalMilestone,
  IssueAdapterCapabilities,
  IssueComment,
  IssueData,
  IssueSearchOptions,
  LinkedIssueRef,
  NO_ISSUE_TYPE,
  UpdateIssueData,
} from "./IssueAdapter";

/**
 * Detect a TipTap doc by structural shape. Mirrors the same check the
 * Jira and Azure DevOps adapters use, so the three adapters agree on
 * what "rich" input looks like (D-15).
 */
function isTiptapDoc(value: unknown): value is { type: "doc"; content: any[] } {
  return (
    value !== null &&
    typeof value === "object" &&
    "type" in value &&
    (value as { type: unknown }).type === "doc"
  );
}

/**
 * Coerce a CreateIssueData/UpdateIssueData description into the markdown
 * string GitHub expects for the issue body. TipTap docs are rendered via
 * the hand-rolled GFM serializer (INT-05); strings pass through unchanged.
 */
function renderGitHubDescription(description: unknown): string {
  if (description === undefined || description === null) return "";
  if (isTiptapDoc(description)) return tiptapToMarkdown(description);
  if (typeof description === "string") return description;
  // Defensive: stringify any other shape so the issue body is never
  // `[object Object]` in the tracker.
  return String(description);
}

/** GitHub caps an issue at ten assignees; the API rejects more. */
const MAX_ASSIGNEES = 10;

/** Every page of a repository listing is read in full-size pages. */
const PAGE_SIZE = 100;

/** Repository listings are read up to this many pages (3,000 entries). */
const MAX_PAGES = 30;

/** An issue's timeline is read up to this many pages (1,000 events). */
const MAX_TIMELINE_PAGES = 10;

/** A repository's linked Projects are read in pages of this size. */
const PROJECTS_PAGE_SIZE = 20;

/** A repository's linked Projects are read up to this many pages (100). */
const MAX_PROJECT_PAGES = 5;

/** A Project's items are read up to this many pages (10,000 items). */
const MAX_PROJECT_ITEM_PAGES = 100;

/**
 * A finished read of a Project's items answers membership questions this
 * long. Long enough for a sync pass to get from one iteration to the next,
 * short enough that a change made in GitHub shows at the next Sync now.
 */
const ITERATION_MEMBERS_TTL_MS = 30 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A renewable token is replaced this long before it expires. */
const TOKEN_RENEWAL_MARGIN_MS = 5 * 60 * 1000;

/** Sent where a request names its media type and REST API version. */
const GITHUB_REST_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

function resolveAssignees(data: {
  assigneeIds?: string[];
  assigneeId?: string;
}): string[] {
  const logins =
    data.assigneeIds && data.assigneeIds.length > 0
      ? data.assigneeIds
      : data.assigneeId
        ? [data.assigneeId]
        : [];
  return Array.from(new Set(logins.filter(Boolean))).slice(0, MAX_ASSIGNEES);
}

/** GitHub addresses milestones by number; anything else is dropped. */
/** `owner/repo#number`, the external id milestone sync stores for a GitHub milestone. */
function milestoneExternalId(owner: string, repo: string, number: number) {
  return `${owner}/${repo}#${number}`;
}

function parseMilestoneRef(
  id: string
): { owner: string; repo: string; number: string } | null {
  const match = id.match(/^([^/#\s]+)\/([^/#\s]+)#(\d+)$/);
  return match ? { owner: match[1], repo: match[2], number: match[3] } : null;
}

function mapGitHubMilestone(
  raw: any,
  owner: string,
  repo: string
): ExternalMilestone {
  const closed = raw.state === "closed";
  const dueOn = raw.due_on ? new Date(raw.due_on) : undefined;
  const closedAt = raw.closed_at ? new Date(raw.closed_at) : undefined;
  return {
    id: milestoneExternalId(owner, repo, raw.number),
    kind: "RELEASE",
    name: raw.title ?? String(raw.number),
    description: raw.description ?? undefined,
    endDate: closed ? (closedAt ?? dueOn) : dueOn,
    state: closed ? "CLOSED" : "ACTIVE",
    rawState: closed ? "closed" : "open",
    url: raw.html_url ?? undefined,
  };
}

/**
 * `owner/repo@<field id>:<iteration id>`, the external id milestone sync
 * stores for an iteration of a GitHub Project. A Project spans repositories
 * and issue numbers repeat between them, so an iteration is tracked per
 * linked repository and holds that repository's issues.
 */
function iterationExternalId(
  owner: string,
  repo: string,
  fieldId: string,
  iterationId: string
) {
  return `${owner}/${repo}@${fieldId}:${iterationId}`;
}

interface IterationRef {
  owner: string;
  repo: string;
  fieldId: string;
  iterationId: string;
}

function parseIterationRef(id: string): IterationRef | null {
  const match = id.match(/^([^/@\s]+)\/([^/@\s]+)@([^:@\s]+):([^:@\s]+)$/);
  return match
    ? {
        owner: match[1],
        repo: match[2],
        fieldId: match[3],
        iterationId: match[4],
      }
    : null;
}

const ITERATION_RAW_STATE: Record<ExternalMilestone["state"], string> = {
  CLOSED: "completed",
  ACTIVE: "current",
  FUTURE: "planned",
};

/**
 * An iteration of a Project. GitHub gives it a first day and a length in
 * days and no state: it is current between its first and last day, and
 * completed once GitHub lists it as such or its last day is over. The days
 * are widened to instants because an iteration's dates are shown in the
 * reader's timezone.
 */
function mapProjectIteration(
  raw: any,
  context: {
    owner: string;
    repo: string;
    fieldId: string;
    projectUrl?: string;
    completed: boolean;
  }
): ExternalMilestone | null {
  if (typeof raw?.id !== "string" || !raw.id) return null;
  const firstDay =
    typeof raw.startDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(raw.startDate)
      ? new Date(`${raw.startDate}T00:00:00Z`)
      : undefined;
  const lastDay =
    firstDay && Number.isInteger(raw.duration) && raw.duration > 0
      ? new Date(firstDay.getTime() + (raw.duration - 1) * DAY_MS)
      : undefined;

  const now = Date.now();
  let state: ExternalMilestone["state"] = "FUTURE";
  if (context.completed || (lastDay && now >= lastDay.getTime() + DAY_MS)) {
    state = "CLOSED";
  } else if (firstDay && now >= firstDay.getTime()) {
    state = "ACTIVE";
  }

  return {
    id: iterationExternalId(
      context.owner,
      context.repo,
      context.fieldId,
      raw.id
    ),
    kind: "ITERATION",
    name: raw.title || raw.id,
    startDate: firstDay ? calendarDateToInstant(firstDay) : undefined,
    endDate: lastDay ? calendarDateToInstant(lastDay) : undefined,
    state,
    rawState: ITERATION_RAW_STATE[state],
    url: context.projectUrl ?? undefined,
  };
}

/** GitHub's own words for why a GraphQL query failed. */
function graphqlErrorText(errors: any[]): string {
  return errors
    .map((error) => error?.message)
    .filter(Boolean)
    .join("; ");
}

/** The server does not know a field or argument the query names. */
function isUnknownSchemaError(error: any): boolean {
  const code = error?.extensions?.code;
  return code === "undefinedField" || code === "argumentNotAccepted";
}

/** The token is not allowed to read what the query asks for. */
function isAccessError(error: any): boolean {
  return error?.type === "INSUFFICIENT_SCOPES" || error?.type === "FORBIDDEN";
}

const PROJECTS_ACCESS_MESSAGE =
  "GitHub refused access to Projects. A personal access token needs the read:project scope; a GitHub App needs read access to the organization's Projects.";

function lowerCased(value: unknown): string | null {
  return typeof value === "string" ? value.toLowerCase() : null;
}

/** An issue field value in the shape the REST API reports it. */
function restIssueFieldValue(node: any): Record<string, unknown> | null {
  const name = node?.field?.name;
  if (typeof name !== "string" || !name) return null;
  const base = {
    issue_field_id: Number(node.field.fullDatabaseId),
    issue_field_name: name,
  };
  switch (node.__typename) {
    case "IssueFieldSingleSelectValue":
      return {
        ...base,
        data_type: "single_select",
        value: node.name,
        single_select_option: { name: node.name },
      };
    case "IssueFieldMultiSelectValue":
      return {
        ...base,
        data_type: "multi_select",
        value: node.value,
        multi_select_options: (node.options ?? []).map((option: any) => ({
          name: option?.name,
        })),
      };
    case "IssueFieldNumberValue":
      return { ...base, data_type: "number", value: node.number };
    case "IssueFieldDateValue":
      return { ...base, data_type: "date", value: node.value };
    case "IssueFieldTextValue":
      return { ...base, data_type: "text", value: node.value };
    default:
      return null;
  }
}

/**
 * An issue read through GraphQL, in the shape the REST API reports it, so
 * one mapping serves both.
 */
function restIssueFromGraphql(node: any, apiRoot: string): any {
  const assignees = (node.assignees?.nodes ?? [])
    .filter((user: any) => user?.login)
    .map((user: any) => ({ login: user.login, avatar_url: user.avatarUrl }));
  // REST lists an issue's field values in the order of their fields' ids.
  const fieldValues = (node.issueFieldValues?.nodes ?? [])
    .map(restIssueFieldValue)
    .filter(Boolean)
    .sort(
      (a: any, b: any) => (a.issue_field_id || 0) - (b.issue_field_id || 0)
    );
  // REST names an App's bot account `<app>[bot]`; GraphQL leaves that off.
  const author = node.author?.login
    ? node.author.__typename === "Bot"
      ? `${node.author.login}[bot]`
      : node.author.login
    : null;
  return {
    number: node.number,
    title: node.title,
    body: node.body,
    state: lowerCased(node.state),
    state_reason: lowerCased(node.stateReason),
    html_url: node.url,
    repository_url: node.repository?.nameWithOwner
      ? `${apiRoot}/repos/${node.repository.nameWithOwner}`
      : undefined,
    created_at: node.createdAt,
    updated_at: node.updatedAt,
    user: author ? { login: author } : null,
    assignee: assignees[0] ?? null,
    assignees,
    labels: (node.labels?.nodes ?? [])
      .filter((label: any) => label?.name)
      .map((label: any) => ({ name: label.name, color: label.color })),
    milestone: node.milestone
      ? {
          number: node.milestone.number,
          title: node.milestone.title,
          state: lowerCased(node.milestone.state),
          due_on: node.milestone.dueOn ?? null,
        }
      : null,
    comments: node.comments?.totalCount,
    issue_field_values: fieldValues,
  };
}

/** Hex colour per label name, or undefined when no label carries one. */
function labelColorsOf(labels: unknown): Record<string, string> | undefined {
  if (!Array.isArray(labels)) return undefined;
  const entries = labels
    .filter(
      (label: any) =>
        label && typeof label === "object" && label.name && label.color
    )
    .map((label: any) => [String(label.name), String(label.color)]);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function parseMilestoneNumber(milestone: string | undefined): number | null {
  if (milestone === undefined || milestone === null || milestone === "") {
    return null;
  }
  const num = Number(milestone);
  return Number.isInteger(num) && num > 0 ? num : null;
}

/**
 * A repository's issue fields, the fields pinned to issues without a type,
 * and the fields pinned to each issue type. Issue fields belong to the
 * repository's owner; REST lists them per organization only, so the
 * repository is asked through GraphQL, which answers for organizations and
 * personal accounts alike.
 */
const ISSUE_FIELDS_QUERY = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    issueFields(first: 100) { nodes { ...field } }
    pinnedIssueFields(first: 100) { nodes { ...fieldId } }
    issueTypes(first: 100) { nodes { name pinnedFields { ...fieldId } } }
  }
}
fragment fieldId on IssueFields {
  ... on IssueFieldText { fullDatabaseId }
  ... on IssueFieldNumber { fullDatabaseId }
  ... on IssueFieldDate { fullDatabaseId }
  ... on IssueFieldSingleSelect { fullDatabaseId }
  ... on IssueFieldMultiSelect { fullDatabaseId }
}
fragment field on IssueFields {
  ... on IssueFieldText { fullDatabaseId name dataType }
  ... on IssueFieldNumber { fullDatabaseId name dataType }
  ... on IssueFieldDate { fullDatabaseId name dataType }
  ... on IssueFieldSingleSelect { fullDatabaseId name dataType options { name } }
  ... on IssueFieldMultiSelect { fullDatabaseId name dataType options { name } }
}`;

/**
 * The files in the repository's issue template folder, and in the folder its
 * owner's `.github` repository keeps for repositories that have none.
 */
const ISSUE_TEMPLATES_QUERY = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    object(expression: "HEAD:.github/ISSUE_TEMPLATE") { ...templateFiles }
  }
  defaults: repository(owner: $owner, name: ".github") {
    object(expression: "HEAD:.github/ISSUE_TEMPLATE") { ...templateFiles }
  }
}
fragment templateFiles on GitObject {
  ... on Tree { entries { name object { ... on Blob { text } } } }
}`;

/**
 * The iteration fields of the Projects linked to a repository, with their
 * open and completed iterations.
 */
const PROJECT_ITERATIONS_QUERY = `
query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    projectsV2(first: ${PROJECTS_PAGE_SIZE}, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        url closed
        fields(first: 100) {
          nodes {
            ... on ProjectV2IterationField {
              id
              configuration {
                iterations { id title startDate duration }
                completedIterations { id title startDate duration }
              }
            }
          }
        }
      }
    }
  }
}`;

/** An iteration field's name and the ids of the iterations it holds. */
const ITERATION_FIELD_QUERY = `
query($field: ID!) {
  node(id: $field) {
    ... on ProjectV2IterationField {
      name
      configuration {
        iterations { id }
        completedIterations { id }
      }
    }
  }
}`;

/** A page of a Project's items: each issue and the iteration it is in. */
const ITERATION_MEMBERS_QUERY = `
query($field: ID!, $name: String!, $after: String) {
  node(id: $field) {
    ... on ProjectV2IterationField {
      project {
        items(first: ${PAGE_SIZE}, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            content { ... on Issue { id repository { nameWithOwner } } }
            fieldValueByName(name: $name) {
              ... on ProjectV2ItemFieldIterationValue { iterationId }
            }
          }
        }
      }
    }
  }
}`;

const ISSUE_FIELD_VALUES_SELECTION = `
      issueFieldValues(first: 100) {
        nodes {
          __typename
          ... on IssueFieldTextValue { value field { ... on IssueFieldText { name fullDatabaseId } } }
          ... on IssueFieldNumberValue { number: value field { ... on IssueFieldNumber { name fullDatabaseId } } }
          ... on IssueFieldDateValue { value field { ... on IssueFieldDate { name fullDatabaseId } } }
          ... on IssueFieldSingleSelectValue { name field { ... on IssueFieldSingleSelect { name fullDatabaseId } } }
          ... on IssueFieldMultiSelectValue { value options { name } field { ... on IssueFieldMultiSelect { name fullDatabaseId } } }
        }
      }`;

/**
 * Issues by node id. A GitHub Enterprise Server that predates issue fields
 * is asked without them.
 */
function issuesByIdQuery(withIssueFields: boolean): string {
  return `
query($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Issue {
      number title body state url createdAt updatedAt
      ${withIssueFields ? "stateReason(enableDuplicate: true)" : "stateReason"}
      repository { nameWithOwner }
      author { __typename login }
      assignees(first: ${MAX_ASSIGNEES}) { nodes { login avatarUrl } }
      labels(first: 100) { nodes { name color } }
      milestone { number title state dueOn }
      comments { totalCount }${withIssueFields ? ISSUE_FIELD_VALUES_SELECTION : ""}
    }
  }
}`;
}

/** GitHub takes a select option by its name, so the name is also its id. */
function fieldOptions(options: unknown): Array<{ id: string; name: string }> {
  if (!Array.isArray(options)) return [];
  return options
    .filter((option: any) => typeof option?.name === "string" && option.name)
    .map((option: any) => ({ id: option.name, name: option.name }));
}

function mapIssueField(raw: any, pinnedTo: string[]): CreateIssueField | null {
  if (raw?.fullDatabaseId == null || !raw.name) return null;
  const base = {
    key: String(raw.fullDatabaseId),
    name: String(raw.name),
    required: false,
    pinnedTo,
  };
  switch (raw.dataType) {
    case "TEXT":
      return { ...base, schema: { type: "string" } };
    case "NUMBER":
      return { ...base, schema: { type: "number" } };
    case "DATE":
      return { ...base, schema: { type: "date" }, input: "date" };
    case "SINGLE_SELECT":
      return {
        ...base,
        schema: { type: "option" },
        allowedValues: fieldOptions(raw.options),
      };
    case "MULTI_SELECT":
      return {
        ...base,
        schema: { type: "array" },
        input: "multiselect",
        allowedValues: fieldOptions(raw.options),
      };
    default:
      return null;
  }
}

/**
 * The `issue_field_values` of a create call. Issue fields are keyed by
 * their numeric id; any other custom field key is not one of them.
 */
function issueFieldValues(
  customFields: Record<string, any> | undefined
): Array<{ field_id: number; value: unknown }> {
  const values: Array<{ field_id: number; value: unknown }> = [];
  for (const [key, value] of Object.entries(customFields ?? {})) {
    if (!/^\d+$/.test(key)) continue;
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    values.push({ field_id: Number(key), value });
  }
  return values;
}

/**
 * An issue's field values by field name. GitHub reports a single select as
 * its option's id and a multi select as one comma-joined string; both are
 * read from the option objects sent beside them instead.
 */
function readIssueFieldValues(raw: unknown): Record<string, unknown> {
  if (!Array.isArray(raw)) return {};
  const values: Record<string, unknown> = {};
  for (const entry of raw) {
    const name = entry?.issue_field_name;
    if (typeof name !== "string" || !name) continue;
    if (entry.data_type === "single_select") {
      values[name] = entry.single_select_option?.name ?? entry.value;
    } else if (
      entry.data_type === "multi_select" &&
      Array.isArray(entry.multi_select_options)
    ) {
      values[name] = entry.multi_select_options.map(
        (option: any) => option?.name
      );
    } else {
      values[name] = entry.value;
    }
  }
  return values;
}

/** The value of the built-in Priority field, GitHub's only notion of one. */
function readIssuePriority(raw: unknown): string | undefined {
  if (!Array.isArray(raw)) return undefined;
  const entry = raw.find(
    (value: any) =>
      value?.data_type === "single_select" &&
      typeof value.issue_field_name === "string" &&
      value.issue_field_name.toLowerCase() === "priority"
  );
  const name = entry?.single_select_option?.name;
  return typeof name === "string" && name ? name : undefined;
}

/**
 * GitHub integration adapter using Personal Access Token authentication
 */
export class GitHubAdapter extends BaseAdapter {
  public supportsOAuth = true;

  private owner?: string;
  private repo?: string;
  // Public GitHub by default; GitHub Enterprise Server installations override
  // this with the full API root (e.g. "https://ghes.example.com/api/v3") via
  // the integration's settings.baseUrl. Trailing slash is normalized off so
  // url-template concatenation stays well-formed.
  private baseUrl = "https://api.github.com";

  // OAuth client credentials, plumbed per-integration by IntegrationManager.
  private clientId?: string;
  // Short repository names resolved to owner/repo by resolveRepository().
  private resolvedRepos = new Map<string, { owner: string; repo: string }>();
  private clientSecret?: string;
  private redirectUri?: string;
  // Set when the token belongs to a GitHub App installation.
  private installation = false;
  private tokenRenewal: Promise<void> | null = null;

  constructor(config: any) {
    super(config);

    // GitHub repository can be specified in settings
    if (config.repository) {
      const [owner, repo] = config.repository.split("/");
      this.owner = owner;
      this.repo = repo;
    }

    if (config.baseUrl) {
      this.baseUrl = config.baseUrl.replace(/\/$/, "");
    }

    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.redirectUri = config.redirectUri;
  }

  /**
   * OAuth authorize/token endpoints live on the web host, not the API host.
   * github.com → https://github.com; GitHub Enterprise Server exposes them at
   * the instance root (API root with the trailing "/api/v3" removed).
   */
  private getOAuthBaseUrl(): string {
    if (this.baseUrl === "https://api.github.com") return "https://github.com";
    return this.baseUrl.replace(/\/api\/v3$/, "");
  }

  getCapabilities(): IssueAdapterCapabilities {
    return {
      createIssue: true,
      updateIssue: true,
      linkIssue: true,
      syncIssue: true,
      searchIssues: true,
      webhooks: true,
      customFields: true,
      attachments: false, // GitHub doesn't support direct attachments on issues
      linkedIssues: true,
      comments: true,
      // Repository milestones map onto RELEASE and the iterations of the
      // Projects linked to the repository onto ITERATION. The `milestone`
      // webhook event keeps synced releases fresh; iterations have no
      // repository webhook and are refreshed by sync alone.
      milestones: { kinds: ["RELEASE", "ITERATION"], webhooks: true },
    };
  }

  protected async performAuthentication(
    authData: AuthenticationData
  ): Promise<void> {
    // authData carries the per-instance baseUrl plumbed by IntegrationManager
    // (settings.baseUrl). Re-apply it here so token validation hits the right
    // server even if the adapter was constructed without it.
    if (authData.baseUrl) {
      this.baseUrl = authData.baseUrl.replace(/\/$/, "");
    }

    if (authData.type === "oauth") {
      if (!authData.accessToken) {
        throw new Error("GitHub OAuth authentication requires an access token");
      }
      // Validate the token. makeRequest sends `Authorization: Bearer <token>`
      // for the oauth auth type, which GitHub accepts for user tokens.
      try {
        await this.makeRequest(`${this.baseUrl}/user`);
      } catch {
        throw new Error("Invalid GitHub OAuth access token");
      }
      return;
    }

    if (authData.type !== "api_key") {
      throw new Error(
        "GitHub adapter only supports OAuth, Personal Access Token and GitHub App authentication"
      );
    }

    if (authData.installation) {
      if (!authData.apiKey) {
        throw new Error("GitHub App authentication requires an access token");
      }
      this.installation = true;
      // An installation token is nobody's, so /user refuses it.
      try {
        await this.makeRequest(
          `${this.baseUrl}/installation/repositories?per_page=1`
        );
      } catch {
        throw new Error("Invalid GitHub App installation token");
      }
      return;
    }

    if (!authData.apiKey) {
      throw new Error(
        "Personal Access Token is required for GitHub authentication"
      );
    }

    // Validate the token by making a test request
    try {
      await this.makeRequest(`${this.baseUrl}/user`);
    } catch {
      throw new Error("Invalid GitHub Personal Access Token");
    }
  }

  /**
   * Build the OAuth authorization URL the user is redirected to for consent.
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId || "",
      redirect_uri: this.redirectUri || "",
      scope: "repo read:user",
      state,
    });
    return `${this.getOAuthBaseUrl()}/login/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange the authorization code for an access token. An OAuth app with
   * "Expire user access tokens" enabled (GitHub's default for new apps) also
   * returns a refresh token and an 8-hour `expires_in`; an app without it
   * returns a token that never expires and no refresh token.
   */
  async exchangeCodeForTokens(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    return this.requestToken(
      { code, redirect_uri: this.redirectUri },
      "exchange code for tokens"
    );
  }

  /**
   * Renew an expiring user access token with its refresh token. GitHub
   * rotates both on every refresh; the manager persists the pair. A dead
   * refresh token (revoked, already rotated, or past its 6-month life) is
   * thrown as `RefreshTokenRevokedError` so the manager flags the row for
   * re-authorization instead of retrying.
   */
  async refreshTokens(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    return this.requestToken(
      { grant_type: "refresh_token", refresh_token: refreshToken },
      "refresh tokens"
    );
  }

  private async requestToken(
    body: Record<string, string | undefined>,
    what: string
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  }> {
    const response = await fetch(
      `${this.getOAuthBaseUrl()}/login/oauth/access_token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          ...body,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to ${what}: ${error}`);
    }

    // GitHub answers 200 with an error object rather than a 4xx.
    const data = await response.json();
    if (data.error) {
      const detail = data.error_description || data.error;
      if (data.error === "bad_refresh_token") {
        throw new RefreshTokenRevokedError("GITHUB", detail);
      }
      throw new Error(`Failed to ${what}: ${detail}`);
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : undefined,
    };
  }

  /**
   * Replaces a renewable token shortly before it expires. A GitHub App
   * installation token lasts an hour, less than a long sync can take.
   */
  private async renewTokenIfDue(): Promise<void> {
    const auth = this.authData;
    if (!auth?.renew || !auth.expiresAt) return;
    const remaining = new Date(auth.expiresAt).getTime() - Date.now();
    if (remaining > TOKEN_RENEWAL_MARGIN_MS) return;
    this.tokenRenewal ??= auth
      .renew()
      .then((fresh) => {
        auth.apiKey = fresh.apiKey;
        auth.expiresAt = fresh.expiresAt;
      })
      .finally(() => {
        this.tokenRenewal = null;
      });
    await this.tokenRenewal;
  }

  protected async makeRequest<T>(
    url: string,
    options: RequestInit = {}
  ): Promise<T> {
    await this.renewTokenIfDue();
    return super.makeRequest<T>(url, options);
  }

  protected async makeBinaryRequest(
    url: string,
    maxBytes: number
  ): Promise<{ buffer: Buffer; contentType?: string }> {
    await this.renewTokenIfDue();
    return super.makeBinaryRequest(url, maxBytes);
  }

  /**
   * The repositories a GitHub App installation was given. An installation
   * has no user, so the listing a user token reads does not answer for it.
   */
  private async listInstallationRepositories(): Promise<any[]> {
    const repositories: any[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await this.makeRequest<any>(
        `${this.baseUrl}/installation/repositories?per_page=${PAGE_SIZE}&page=${page}`
      );
      const items: any[] = Array.isArray(body?.repositories)
        ? body.repositories
        : [];
      repositories.push(...items);
      if (items.length < PAGE_SIZE) break;
    }
    return repositories;
  }

  protected buildUrl(path: string): string {
    if (path.startsWith("/repos/") && this.owner && this.repo) {
      // Replace placeholder with actual owner/repo
      return `${this.baseUrl}${path.replace("{owner}/{repo}", `${this.owner}/${this.repo}`)}`;
    }
    return `${this.baseUrl}${path}`;
  }

  async createIssue(data: CreateIssueData): Promise<IssueData> {
    // Resolved per call: the adapter is cached per integration and shared by
    // every project linked to it, each of which may target its own repository.
    const { owner, repo } = await this.resolveRepository(
      data.externalProjectId?.includes("/")
        ? data.externalProjectId
        : data.projectId
    );

    // INT-05: description may arrive as a TipTap doc (e.g. failed-iteration
    // body builder). Render to GFM markdown before posting to GitHub.
    const assignees = resolveAssignees(data);
    const milestone = parseMilestoneNumber(data.milestone);
    const fieldValues = issueFieldValues(data.customFields);
    const githubPayload = {
      title: data.title,
      body: renderGitHubDescription(data.description),
      labels: data.labels || [],
      assignees: assignees.length > 0 ? assignees : undefined,
      milestone: milestone ?? undefined,
      // Organization issue types are addressed by name; GitHub ignores
      // the field on repositories whose owner has none.
      type: data.issueType || undefined,
      issue_field_values: fieldValues.length > 0 ? fieldValues : undefined,
    };

    const response = await this.makeRequest<any>(
      `${this.baseUrl}/repos/${owner}/${repo}/issues`,
      {
        method: "POST",
        body: JSON.stringify(githubPayload),
      }
    );

    return this.mapGitHubIssue(response);
  }

  async updateIssue(
    issueId: string,
    data: UpdateIssueData
  ): Promise<IssueData> {
    const updatePayload: any = {};

    if (data.title !== undefined) {
      updatePayload.title = data.title;
    }

    if (data.description !== undefined) {
      updatePayload.body = renderGitHubDescription(data.description);
    }

    if (data.status !== undefined) {
      updatePayload.state = this.mapStatusToGitHub(data.status);
    }

    if (data.labels !== undefined) {
      updatePayload.labels = data.labels;
    }

    if (data.assigneeIds !== undefined || data.assigneeId !== undefined) {
      updatePayload.assignees = resolveAssignees(data);
    }

    if (data.milestone !== undefined) {
      updatePayload.milestone = parseMilestoneNumber(data.milestone);
    }

    const response = await this.makeRequest<any>(
      this.buildUrl(`/repos/{owner}/{repo}/issues/${issueId}`),
      {
        method: "PATCH",
        body: JSON.stringify(updatePayload),
      }
    );

    return this.mapGitHubIssue(response);
  }

  async getIssue(issueId: string): Promise<IssueData> {
    const { owner, repo, issueNumber } = this.parseIssueRef(issueId);

    const response = await this.makeRequest<any>(
      `${this.baseUrl}/repos/${owner}/${repo}/issues/${issueNumber}`
    );

    return this.mapGitHubIssue(response);
  }

  /**
   * The parent issue, sub-issues, dependencies, "relates to" links and the
   * issues that mention this one. Each lookup fails on its own, and an issue
   * linked more than one way is reported once, under the first relationship
   * in that order.
   */
  async getLinkedIssues(issueId: string): Promise<LinkedIssueRef[]> {
    let owner: string;
    let repo: string;
    let issueNumber: string;
    try {
      ({ owner, repo, issueNumber } = this.parseIssueRef(issueId));
    } catch (error) {
      console.warn(
        `[GitHubAdapter] getLinkedIssues failed for %s:`,
        issueId,
        error
      );
      return [];
    }

    const repository = `${owner}/${repo}`;
    const issueUrl = `${this.baseUrl}/repos/${repository}/issues/${issueNumber}`;
    const linkList = (
      path: string,
      linkType: string,
      direction: LinkedIssueRef["direction"]
    ) =>
      this.fetchIssueLinks(
        `${issueUrl}/${path}`,
        repository,
        linkType,
        direction
      );
    const lookups: Array<{
      name: string;
      /** Missing on GitHub Enterprise Server releases older than the feature. */
      optional?: boolean;
      load: () => Promise<LinkedIssueRef[]>;
    }> = [
      {
        // Answers 404 for an issue that is nobody's sub-issue.
        name: "parent",
        optional: true,
        load: async () => {
          const parent = await this.makeRequest<any>(`${issueUrl}/parent`, {
            headers: GITHUB_REST_HEADERS,
          });
          const ref = this.linkedIssueRef(
            parent,
            repository,
            "parent",
            "inward"
          );
          return ref ? [ref] : [];
        },
      },
      {
        name: "sub_issues",
        load: () => linkList("sub_issues", "sub_issue", "outward"),
      },
      {
        name: "blocked_by",
        optional: true,
        load: () => linkList("dependencies/blocked_by", "blocked_by", "inward"),
      },
      {
        name: "blocking",
        optional: true,
        load: () => linkList("dependencies/blocking", "blocking", "outward"),
      },
      {
        name: "relates_to",
        optional: true,
        load: () => linkList("relates_to", "relates_to", "outward"),
      },
      {
        name: "timeline",
        load: () => this.fetchCrossReferences(issueUrl, repository),
      },
    ];

    const results = await Promise.allSettled(
      lookups.map((lookup) => lookup.load())
    );

    const refs = new Map<string, LinkedIssueRef>();
    results.forEach((result, index) => {
      const lookup = lookups[index];
      if (result.status === "fulfilled") {
        for (const ref of result.value) {
          const identity = ref.id.toLowerCase();
          if (!refs.has(identity)) refs.set(identity, ref);
        }
        return;
      }
      const status = this.parseStatusFromError(result.reason);
      if (lookup.optional && (status === 404 || status === 410)) return;
      const level = status === null || status >= 500 ? "error" : "warn";
      console[level](
        `[GitHubAdapter] ${lookup.name} failed for %s:`,
        issueId,
        result.reason
      );
    });

    return [...refs.values()];
  }

  async getIssueComments(issueId: string): Promise<IssueComment[]> {
    try {
      const { owner, repo, issueNumber } = this.parseIssueRef(issueId);
      const response = await this.listAllPages<any>(
        `${this.baseUrl}/repos/${owner}/${repo}/issues/${issueNumber}/comments`
      );
      return this.mapGitHubComments(response);
    } catch (error) {
      const status = this.parseStatusFromError(error);
      const level = status === null || status >= 500 ? "error" : "warn";
      console[level](
        `[GitHubAdapter] getIssueComments failed for %s:`,
        issueId,
        error
      );
      return [];
    }
  }

  /**
   * Writes the one comment an issue holds for `marker`, the text its body
   * starts with. The newest comment that starts with it is replaced; a
   * comment is added when there is none, or when the newest cannot be
   * edited because another account wrote it. Reading the comments throws on
   * failure, so a failed read never adds a second comment.
   */
  async upsertIssueComment(
    issueId: string,
    marker: string,
    body: string
  ): Promise<{ id?: string; created: boolean; changed: boolean }> {
    const { owner, repo, issueNumber } = this.parseIssueRef(issueId);
    const repository = `${this.baseUrl}/repos/${owner}/${repo}`;
    const comments = await this.listAllPages<any>(
      `${repository}/issues/${issueNumber}/comments`
    );
    const existing = [...comments]
      .reverse()
      .find(
        (comment) =>
          comment?.id != null &&
          typeof comment.body === "string" &&
          comment.body.startsWith(marker)
      );

    if (existing) {
      if (existing.body === body) {
        return { id: String(existing.id), created: false, changed: false };
      }
      try {
        await this.makeRequest(`${repository}/issues/comments/${existing.id}`, {
          method: "PATCH",
          body: JSON.stringify({ body }),
        });
        return { id: String(existing.id), created: false, changed: true };
      } catch (error) {
        const status = this.parseStatusFromError(error);
        if (status !== 403 && status !== 404) throw error;
      }
    }

    const created = await this.makeRequest<any>(
      `${repository}/issues/${issueNumber}/comments`,
      { method: "POST", body: JSON.stringify({ body }) }
    );
    return {
      id: created?.id != null ? String(created.id) : undefined,
      created: true,
      changed: true,
    };
  }

  async searchIssues(options: IssueSearchOptions): Promise<{
    issues: IssueData[];
    total: number;
    hasMore: boolean;
  }> {
    // "#42" is an exact lookup. GitHub's search API has no `number:`
    // qualifier and indexes new issues late, so fetch the issue itself.
    const numMatch = options.query?.match(/^#(\d+)$/);
    if (numMatch) {
      return this.lookupIssueByNumber(numMatch[1], options);
    }

    const searchQuery: string[] = [];

    // Always add is:issue to filter out pull requests (required by GitHub API)
    searchQuery.push("is:issue");

    // Add repo filter
    if (this.owner && this.repo) {
      searchQuery.push(`repo:${this.owner}/${this.repo}`);
    } else if (options.projectId) {
      searchQuery.push(`repo:${options.projectId}`);
    }

    if (options.query) {
      searchQuery.push(options.query);
    }

    // Add status filter
    if (options.status && options.status.length > 0) {
      const states = options.status.map((s) => this.mapStatusToGitHub(s));
      searchQuery.push(`is:${states.join(" is:")}`);
    }

    // Add assignee filter
    if (options.assignee) {
      searchQuery.push(`assignee:${options.assignee}`);
    }

    // Add label filter
    if (options.labels && options.labels.length > 0) {
      searchQuery.push(options.labels.map((l) => `label:"${l}"`).join(" "));
    }

    // Bulk-import recency window — GitHub's search API takes an ISO date
    // (YYYY-MM-DD) with the `updated:>=` range qualifier.
    if (options.updatedWithinDays && options.updatedWithinDays > 0) {
      const cutoff = new Date(
        Date.now() - Math.floor(options.updatedWithinDays) * 86_400_000
      )
        .toISOString()
        .slice(0, 10);
      searchQuery.push(`updated:>=${cutoff}`);
    }

    const params = new URLSearchParams({
      q: searchQuery.join(" "),
      per_page: (options.limit || 30).toString(),
      page: Math.floor(
        (options.offset || 0) / (options.limit || 30) + 1
      ).toString(),
      sort: "created",
      order: "desc",
    });

    const response = await this.makeRequest<any>(
      `${this.baseUrl}/search/issues?${params.toString()}`
    );

    return {
      issues: response.items.map((issue: any) => this.mapGitHubIssue(issue)),
      total: response.total_count,
      hasMore:
        response.incomplete_results ||
        response.total_count > (options.offset || 0) + response.items.length,
    };
  }

  private async lookupIssueByNumber(
    issueNumber: string,
    options: IssueSearchOptions
  ): Promise<{ issues: IssueData[]; total: number; hasMore: boolean }> {
    const empty = { issues: [], total: 0, hasMore: false };
    const repoPath =
      this.owner && this.repo
        ? `${this.owner}/${this.repo}`
        : options.projectId;
    if (!repoPath) return empty;
    let raw: any;
    try {
      raw = await this.makeRequest<any>(
        `${this.baseUrl}/repos/${repoPath}/issues/${issueNumber}`
      );
    } catch (error: any) {
      if (error?.status === 404) return empty;
      throw error;
    }
    // The issues endpoint also answers for pull requests.
    if (!raw || raw.pull_request) return empty;
    const issue = this.mapGitHubIssue(raw);
    if (options.status?.length && !options.status.includes(issue.status)) {
      return empty;
    }
    return { issues: [issue], total: 1, hasMore: false };
  }

  protected async addComment(issueId: string, comment: string): Promise<void> {
    await this.makeRequest(
      this.buildUrl(`/repos/{owner}/{repo}/issues/${issueId}/comments`),
      {
        method: "POST",
        body: JSON.stringify({ body: comment }),
      }
    );
  }

  /**
   * Get available repositories for the authenticated user
   */
  async getProjects(): Promise<
    Array<{ id: string; key: string; name: string }>
  > {
    const repos = this.installation
      ? await this.listInstallationRepositories()
      : await this.listAllPages<any>(`${this.baseUrl}/user/repos`, {
          sort: "updated",
        });

    return repos.map((repo) => ({
      id: repo.full_name,
      key: repo.name,
      name: repo.full_name,
    }));
  }

  /**
   * Resolves the {owner, repo} pair a repository-scoped read should hit.
   * Mapped tracker projects carry either the full name ("owner/repo" —
   * `getProjects` returns `repo.full_name` as the id) or the short repo
   * name (the same call's `key`); a short name borrows the owner from the
   * integration's configured repository. No argument falls back to the
   * configured repository whole.
   */
  private resolveRepoRef(projectKey?: string): {
    owner: string;
    repo: string;
  } {
    if (projectKey?.includes("/")) {
      const [owner, repo] = projectKey.split("/");
      if (owner && repo) {
        return { owner, repo };
      }
    }
    if (this.owner && projectKey) {
      return { owner: this.owner, repo: projectKey };
    }
    if (this.owner && this.repo) {
      return { owner: this.owner, repo: this.repo };
    }
    throw new Error("Repository not configured");
  }

  /**
   * Like `resolveRepoRef`, but a short repository name with no configured
   * owner is looked up among the repositories this connection can access —
   * the same list a project's linked repository was chosen from.
   */
  private async resolveRepository(
    projectKey?: string
  ): Promise<{ owner: string; repo: string }> {
    if (!projectKey || projectKey.includes("/") || this.owner) {
      return this.resolveRepoRef(projectKey);
    }

    const cached = this.resolvedRepos.get(projectKey.toLowerCase());
    if (cached) {
      return cached;
    }

    const matches: string[] = [];
    const collect = (repos: any[]) => {
      for (const repo of repos) {
        if (repo.name?.toLowerCase() === projectKey.toLowerCase()) {
          matches.push(repo.full_name);
        }
      }
    };
    if (this.installation) {
      collect(await this.listInstallationRepositories());
    } else {
      for (let page = 1; page <= 10; page++) {
        const repos = await this.makeRequest<any[]>(
          `${this.baseUrl}/user/repos?per_page=100&page=${page}`
        );
        collect(repos);
        if (repos.length < 100) {
          break;
        }
      }
    }

    if (matches.length === 1) {
      const [owner, repo] = matches[0].split("/");
      const ref = { owner, repo };
      this.resolvedRepos.set(projectKey.toLowerCase(), ref);
      return ref;
    }
    if (matches.length > 1) {
      throw new Error(
        `More than one accessible GitHub repository is named "${projectKey}" (${matches.join(", ")}), so it cannot be identified by name alone.`
      );
    }
    throw new Error(
      `GitHub repository "${projectKey}" was not found among the repositories this connection can access.`
    );
  }

  /**
   * GitHub models no issue types — repository LABELS are the designation
   * vocabulary this adapter serves through the issue-type contract, the
   * way GitLab's own `getIssueTypes` returns a list its tracker never
   * enumerates. `id === name` deliberately: a label reaches issue
   * payloads (`mapGitHubIssue`'s `labels`) only as its name, so the name
   * is the only join key classification can use — see
   * `matchesRequirementDesignation`'s type-vs-label precedence contract.
   * Paged to three pages (300 labels), comfortably past the
   * requirement-config selection cap of 200.
   */
  async getIssueTypes(
    projectKey: string
  ): Promise<Array<{ id: string; name: string }>> {
    const { owner, repo } = await this.resolveRepository(projectKey);

    const labels: Array<{ id: string; name: string }> = [];
    for (let page = 1; page <= 3; page++) {
      const pageLabels = await this.makeRequest<any[]>(
        `${this.baseUrl}/repos/${owner}/${repo}/labels?per_page=100&page=${page}`
      );
      labels.push(
        ...pageLabels.map((label: any) => ({
          id: label.name,
          name: label.name,
        }))
      );
      if (pageLabels.length < 100) {
        break;
      }
    }
    return labels;
  }

  /**
   * Reads every page of a list endpoint. `url` must not already carry a
   * query string.
   */
  private async listAllPages<T = any>(
    url: string,
    query: Record<string, string> = {},
    init?: RequestInit,
    maxPages: number = MAX_PAGES
  ): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const params = new URLSearchParams({
        ...query,
        per_page: String(PAGE_SIZE),
        page: String(page),
      });
      const pageItems = await this.makeRequest<T[]>(`${url}?${params}`, init);
      items.push(...pageItems);
      if (pageItems.length < PAGE_SIZE) {
        break;
      }
    }
    return items;
  }

  /**
   * The repository's labels, by name — the key GitHub takes on create.
   */
  async getLabels(
    projectKey: string
  ): Promise<Array<{ id: string; name: string; color: string }>> {
    const { owner, repo } = await this.resolveRepository(projectKey);
    const labels = await this.listAllPages<any>(
      `${this.baseUrl}/repos/${owner}/${repo}/labels`
    );
    return labels.map((label) => ({
      id: label.name,
      name: label.name,
      color: label.color,
    }));
  }

  /**
   * The repository's milestones, by number — the key GitHub takes on
   * create. Open ones by default; `state: "all"` includes closed ones.
   */
  async getMilestones(
    projectKey: string,
    state: "open" | "closed" | "all" = "open"
  ): Promise<
    Array<{
      id: string;
      title: string;
      state: string;
      dueOn: string | null;
      externalId: string;
    }>
  > {
    const { owner, repo } = await this.resolveRepository(projectKey);
    const milestones = await this.listAllPages<any>(
      `${this.baseUrl}/repos/${owner}/${repo}/milestones`,
      { state, sort: "due_on", direction: "asc" }
    );
    return milestones.map((milestone) => ({
      id: String(milestone.number),
      title: milestone.title,
      state: milestone.state,
      dueOn: milestone.due_on ?? null,
      externalId: milestoneExternalId(owner, repo, milestone.number),
    }));
  }

  /**
   * Repository milestones and Project iterations in the provider-neutral
   * shape milestone sync consumes. GitHub milestones are per repository and
   * addressed by number, so a RELEASE's external id is `owner/repo#number` —
   * unique across the integration and enough for `getMilestoneIssues` to
   * find the repository again. A milestone is ACTIVE while open and CLOSED
   * once closed; GitHub has no planned-but-not-started state for one.
   *
   * Asked for both kinds at once, a failure to read iterations is returned
   * as a warning beside the releases: Projects need access that milestones
   * do not. Asked for iterations alone, it is thrown.
   */
  async getExternalMilestones(options: {
    projectKey: string;
    kind?: "RELEASE" | "ITERATION";
    includeClosed?: boolean;
    pageToken?: string;
  }): Promise<{
    items: ExternalMilestone[];
    hasMore: boolean;
    nextPageToken?: string;
    warnings?: string[];
  }> {
    const { owner, repo } = await this.resolveRepository(options.projectKey);
    const includeClosed = options.includeClosed === true;
    const items: ExternalMilestone[] = [];
    const warnings: string[] = [];

    if (options.kind !== "ITERATION") {
      const milestones = await this.listAllPages<any>(
        `${this.baseUrl}/repos/${owner}/${repo}/milestones`,
        {
          state: includeClosed ? "all" : "open",
          sort: "due_on",
          direction: "asc",
        }
      );
      items.push(
        ...milestones.map((milestone) =>
          mapGitHubMilestone(milestone, owner, repo)
        )
      );
    }

    if (options.kind === "ITERATION") {
      items.push(
        ...(await this.getProjectIterations(owner, repo, includeClosed))
      );
    } else if (!options.kind) {
      try {
        items.push(
          ...(await this.getProjectIterations(owner, repo, includeClosed))
        );
      } catch (error: any) {
        warnings.push(error?.message ?? "Project iterations could not be read");
      }
    }

    return {
      items,
      hasMore: false,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  /**
   * The iterations of the Projects linked to a repository. A Project is
   * linked from the repository's Projects tab; an iteration field of a
   * Project that is not linked there is not found. The iterations of a
   * closed Project count as completed.
   */
  private async getProjectIterations(
    owner: string,
    repo: string,
    includeClosed: boolean
  ): Promise<ExternalMilestone[]> {
    const items: ExternalMilestone[] = [];
    let after: string | null = null;

    for (let page = 0; page < MAX_PROJECT_PAGES; page++) {
      const { data, errors } = await this.graphql(PROJECT_ITERATIONS_QUERY, {
        owner,
        name: repo,
        after,
      });
      const projects = data?.repository?.projectsV2;
      if (!projects) {
        // A GitHub Enterprise Server without Projects has no iterations.
        if (errors.some(isUnknownSchemaError)) return [];
        if (errors.some(isAccessError)) {
          throw new Error(PROJECTS_ACCESS_MESSAGE);
        }
        throw new Error(
          graphqlErrorText(errors) ||
            "GitHub returned no Projects for the repository"
        );
      }

      for (const project of projects.nodes ?? []) {
        if (!project || (project.closed && !includeClosed)) continue;
        for (const field of project.fields?.nodes ?? []) {
          if (typeof field?.id !== "string" || !field.configuration) continue;
          const lists: Array<[any[], boolean]> = [
            [field.configuration.iterations ?? [], false],
            [field.configuration.completedIterations ?? [], true],
          ];
          for (const [iterations, completed] of lists) {
            for (const iteration of iterations) {
              const item = mapProjectIteration(iteration, {
                owner,
                repo,
                fieldId: field.id,
                projectUrl: project.url,
                completed: completed || project.closed === true,
              });
              if (item) items.push(item);
            }
          }
        }
      }

      if (!projects.pageInfo?.hasNextPage) break;
      after = projects.pageInfo.endCursor ?? null;
    }

    return includeClosed
      ? items
      : items.filter((item) => item.state !== "CLOSED");
  }

  // Issues by iteration, per iteration field, from one read of the field's
  // Project. Kept briefly so refreshing each iteration of a Project in turn
  // reads the Project once. A read still under way is shared however long
  // it takes; its age counts from when it finished.
  private iterationMembers = new Map<
    string,
    {
      loadedAt: number | null;
      members: Promise<Map<string, Array<{ id: string; repository: string }>>>;
    }
  >();

  private loadIterationMembers(
    fieldId: string
  ): Promise<Map<string, Array<{ id: string; repository: string }>>> {
    const cached = this.iterationMembers.get(fieldId);
    if (
      cached &&
      (cached.loadedAt === null ||
        Date.now() - cached.loadedAt < ITERATION_MEMBERS_TTL_MS)
    ) {
      return cached.members;
    }
    const entry = {
      loadedAt: null as number | null,
      members: this.readIterationMembers(fieldId),
    };
    this.iterationMembers.set(fieldId, entry);
    entry.members.then(
      () => {
        entry.loadedAt = Date.now();
      },
      () => {
        if (this.iterationMembers.get(fieldId) === entry) {
          this.iterationMembers.delete(fieldId);
        }
      }
    );
    return entry.members;
  }

  /**
   * Every issue of a Project by the iteration the field puts it in. Each
   * iteration the field holds has an entry, empty when no issue is in it;
   * an iteration without an entry no longer exists. A Project with more
   * items than are read is an error: a partial list would read as the rest
   * having left their iterations.
   */
  private async readIterationMembers(
    fieldId: string
  ): Promise<Map<string, Array<{ id: string; repository: string }>>> {
    const field = await this.graphql(ITERATION_FIELD_QUERY, { field: fieldId });
    const name = field.data?.node?.name;
    if (typeof name !== "string" || !name) {
      if (field.errors.some(isAccessError)) {
        throw new Error(PROJECTS_ACCESS_MESSAGE);
      }
      throw new Error(
        graphqlErrorText(field.errors) ||
          `GitHub Project iteration field ${fieldId} was not found`
      );
    }

    const members = new Map<
      string,
      Array<{ id: string; repository: string }>
    >();
    const configuration = field.data.node.configuration ?? {};
    for (const iteration of [
      ...(configuration.iterations ?? []),
      ...(configuration.completedIterations ?? []),
    ]) {
      if (typeof iteration?.id === "string") members.set(iteration.id, []);
    }

    let after: string | null = null;
    for (let page = 0; page < MAX_PROJECT_ITEM_PAGES; page++) {
      const { data, errors } = await this.graphql(ITERATION_MEMBERS_QUERY, {
        field: fieldId,
        name,
        after,
      });
      const items = data?.node?.project?.items;
      if (!items) {
        throw new Error(
          graphqlErrorText(errors) || "GitHub returned no items for the Project"
        );
      }
      for (const item of items.nodes ?? []) {
        const iterationId = item?.fieldValueByName?.iterationId;
        const issueId = item?.content?.id;
        const repository = item?.content?.repository?.nameWithOwner;
        if (
          typeof iterationId !== "string" ||
          typeof issueId !== "string" ||
          typeof repository !== "string"
        ) {
          continue;
        }
        const list = members.get(iterationId) ?? [];
        list.push({ id: issueId, repository: repository.toLowerCase() });
        members.set(iterationId, list);
      }
      if (!items.pageInfo?.hasNextPage) return members;
      after = items.pageInfo.endCursor ?? null;
    }
    throw new Error(
      `The GitHub Project has more than ${MAX_PROJECT_ITEM_PAGES * PAGE_SIZE} items; its iterations cannot be read in full`
    );
  }

  /**
   * The issues of one repository in an iteration, a page at a time. Pull
   * requests and draft items are left out. An iteration that no longer
   * exists is an error, never an empty list, which would read as every
   * member having left.
   */
  private async getIterationIssues(
    ref: IterationRef,
    options?: { pageToken?: string; limit?: number }
  ): Promise<{
    issues: IssueData[];
    total?: number;
    hasMore: boolean;
    nextPageToken?: string;
  }> {
    const members = (await this.loadIterationMembers(ref.fieldId)).get(
      ref.iterationId
    );
    if (!members) {
      throw new Error(
        `GitHub Project iteration ${ref.iterationId} was not found`
      );
    }
    const repository = `${ref.owner}/${ref.repo}`.toLowerCase();
    const ids = members
      .filter((member) => member.repository === repository)
      .map((member) => member.id);

    const offset = Math.max(0, Number(options?.pageToken) || 0);
    const limit = Math.min(PAGE_SIZE, Math.max(1, options?.limit ?? PAGE_SIZE));
    const pageIds = ids.slice(offset, offset + limit);
    if (pageIds.length === 0) {
      return { issues: [], total: ids.length, hasMore: false };
    }

    let response = await this.graphql(issuesByIdQuery(true), { ids: pageIds });
    if (!response.data?.nodes && response.errors.some(isUnknownSchemaError)) {
      response = await this.graphql(issuesByIdQuery(false), { ids: pageIds });
    }
    const nodes = response.data?.nodes;
    if (!Array.isArray(nodes)) {
      throw new Error(
        graphqlErrorText(response.errors) ||
          "GitHub returned no issues for the iteration"
      );
    }

    const hasMore = offset + pageIds.length < ids.length;
    return {
      issues: nodes
        .filter((node) => typeof node?.number === "number")
        .map((node) =>
          this.mapGitHubIssue(restIssueFromGraphql(node, this.baseUrl))
        ),
      total: ids.length,
      hasMore,
      nextPageToken: hasMore ? String(offset + pageIds.length) : undefined,
    };
  }

  /**
   * The issues in a milestone, a page at a time. The issues endpoint also
   * lists pull requests, which are left out; a page can therefore come back
   * short of `limit` while more pages remain, so `hasMore` follows the raw
   * page size rather than the filtered one.
   */
  async getMilestoneIssues(
    ref: { id: string; kind: "RELEASE" | "ITERATION" },
    options?: { pageToken?: string; limit?: number }
  ): Promise<{
    issues: IssueData[];
    total?: number;
    hasMore: boolean;
    nextPageToken?: string;
  }> {
    if (ref.kind === "ITERATION") {
      const iteration = parseIterationRef(ref.id);
      return iteration
        ? this.getIterationIssues(iteration, options)
        : { issues: [], hasMore: false };
    }
    const parsed = parseMilestoneRef(ref.id);
    if (!parsed) {
      return { issues: [], hasMore: false };
    }
    const { owner, repo, number } = parsed;
    const page = Math.max(1, Number(options?.pageToken) || 1);
    const perPage = Math.min(100, Math.max(1, options?.limit ?? 100));
    const params = new URLSearchParams({
      milestone: number,
      state: "all",
      per_page: String(perPage),
      page: String(page),
    });
    const raw = await this.makeRequest<any[]>(
      `${this.baseUrl}/repos/${owner}/${repo}/issues?${params.toString()}`
    );
    const items = Array.isArray(raw) ? raw : [];
    const hasMore = items.length === perPage;
    return {
      issues: items
        .filter((issue) => !issue.pull_request)
        .map((issue) => this.mapGitHubIssue(issue)),
      hasMore,
      nextPageToken: hasMore ? String(page + 1) : undefined,
    };
  }

  /**
   * The users the repository lets an issue be assigned to.
   */
  async getAssignableUsers(
    projectKey: string
  ): Promise<Array<{ id: string; name: string; avatarUrl?: string }>> {
    const { owner, repo } = await this.resolveRepository(projectKey);
    const users = await this.listAllPages<any>(
      `${this.baseUrl}/repos/${owner}/${repo}/assignees`
    );
    return users.map((user) => ({
      id: user.login,
      name: user.login,
      avatarUrl: user.avatar_url,
    }));
  }

  /**
   * The issue types the repository's owner defines, by name — the key
   * GitHub takes on create. The repository endpoint answers for
   * organizations and personal accounts alike; a GitHub Enterprise Server
   * that predates it is asked through the organization endpoint. An owner
   * without the feature has none: both answer 404 and this returns an empty
   * list. Disabled types are left out because GitHub refuses them on create.
   */
  async getOrgIssueTypes(projectKey: string): Promise<
    Array<{
      id: string;
      name: string;
      description: string | null;
      color: string | null;
    }>
  > {
    const { owner, repo } = await this.resolveRepository(projectKey);
    const endpoints = [
      `${this.baseUrl}/repos/${owner}/${repo}/issue-types`,
      `${this.baseUrl}/orgs/${encodeURIComponent(owner)}/issue-types`,
    ];
    let types: any[] = [];
    for (const endpoint of endpoints) {
      try {
        types = await this.makeRequest<any[]>(endpoint);
        break;
      } catch (error: any) {
        if (error?.status !== 404) {
          throw error;
        }
      }
    }
    return (Array.isArray(types) ? types : [])
      .filter((type) => type.is_enabled !== false)
      .map((type) => ({
        id: type.name,
        name: type.name,
        description: type.description ?? null,
        color: type.color ?? null,
      }));
  }

  /**
   * GraphQL lives beside the REST root: api.github.com/graphql, and
   * `<host>/api/graphql` on GitHub Enterprise Server (REST is `/api/v3`).
   */
  private getGraphqlUrl(): string {
    if (/\/api\/v3$/.test(this.baseUrl)) {
      return this.baseUrl.replace(/\/v3$/, "/graphql");
    }
    return `${this.baseUrl}/graphql`;
  }

  /** Runs a GraphQL query and returns its data beside any errors. */
  private async graphql(
    query: string,
    variables: Record<string, unknown>
  ): Promise<{ data: any; errors: any[] }> {
    const response = await this.makeRequest<any>(this.getGraphqlUrl(), {
      method: "POST",
      body: JSON.stringify({ query, variables }),
    });
    return {
      data: response?.data ?? null,
      errors: Array.isArray(response?.errors) ? response.errors : [],
    };
  }

  /**
   * Runs a GraphQL query that takes `$owner` and `$name` and selects
   * `repository`. Answers null when the server does not know a field the
   * query names, and throws when it returns no repository.
   */
  private async queryRepository(
    query: string,
    projectKey: string
  ): Promise<any | null> {
    const { owner, repo } = await this.resolveRepository(projectKey);
    const { data, errors } = await this.graphql(query, { owner, name: repo });
    if (data?.repository) return data;

    if (errors.some((error) => error?.extensions?.code === "undefinedField")) {
      return null;
    }
    throw new Error(
      graphqlErrorText(errors) || "GitHub returned no repository for the query"
    );
  }

  /**
   * The repository's issue templates and issue forms. A repository with no
   * template folder of its own uses the one in its owner's `.github`
   * repository, as GitHub does.
   */
  async getIssueTemplates(projectKey: string): Promise<IssueTemplateSet> {
    const data = await this.queryRepository(ISSUE_TEMPLATES_QUERY, projectKey);
    const files = (repository: any) =>
      (repository?.object?.entries ?? [])
        .filter((entry: any) => typeof entry?.name === "string")
        .map((entry: any) => ({
          name: entry.name as string,
          text: entry.object?.text as string | null | undefined,
        }));
    const own = files(data?.repository);
    return parseIssueTemplates(own.length > 0 ? own : files(data?.defaults));
  }

  /**
   * The issue fields of the repository's owner, with the issue types each
   * is pinned to. A GitHub Enterprise Server that predates issue fields
   * does not know the query and has none.
   */
  async getIssueFields(projectKey: string): Promise<CreateIssueField[]> {
    const data = await this.queryRepository(ISSUE_FIELDS_QUERY, projectKey);
    if (!data) return [];
    const repository = data.repository;

    const pinnedTo = new Map<string, string[]>();
    const pin = (field: any, typeId: string) => {
      if (field?.fullDatabaseId == null) return;
      const key = String(field.fullDatabaseId);
      pinnedTo.set(key, [...(pinnedTo.get(key) ?? []), typeId]);
    };
    const types: any[] = (repository.issueTypes?.nodes ?? []).filter(
      (type: any) => type?.name
    );
    // A token that cannot read the organization gets every type back with
    // nothing pinned to it. The fields pinned to issues without a type then
    // stand in for each type.
    const typePinsKnown = types.some(
      (type) => (type.pinnedFields ?? []).length > 0
    );
    for (const field of repository.pinnedIssueFields?.nodes ?? []) {
      pin(field, NO_ISSUE_TYPE);
      if (!typePinsKnown) {
        for (const type of types) pin(field, type.name);
      }
    }
    for (const type of types) {
      for (const field of type.pinnedFields ?? []) {
        pin(field, type.name);
      }
    }

    return (repository.issueFields?.nodes ?? [])
      .map((field: any) =>
        mapIssueField(field, pinnedTo.get(String(field?.fullDatabaseId)) ?? [])
      )
      .filter(
        (field: CreateIssueField | null): field is CreateIssueField =>
          field !== null
      );
  }

  /**
   * Everything the create form can offer for one repository. The lists
   * are fetched together; one that fails is returned empty so the form
   * still opens with the rest.
   */
  async getCreateIssueMetadata(
    projectKey: string
  ): Promise<CreateIssueMetadata> {
    const [labels, milestones, assignees, issueTypes, fields, templateSet] =
      await Promise.all([
        this.getLabels(projectKey).catch((error) => {
          console.error("[GitHubAdapter] getLabels failed:", error);
          return [];
        }),
        this.getMilestones(projectKey).catch((error) => {
          console.error("[GitHubAdapter] getMilestones failed:", error);
          return [];
        }),
        this.getAssignableUsers(projectKey).catch((error) => {
          console.error("[GitHubAdapter] getAssignableUsers failed:", error);
          return [];
        }),
        this.getOrgIssueTypes(projectKey).catch((error) => {
          console.error("[GitHubAdapter] getOrgIssueTypes failed:", error);
          return [];
        }),
        this.getIssueFields(projectKey).catch((error) => {
          console.error("[GitHubAdapter] getIssueFields failed:", error);
          return [];
        }),
        this.getIssueTemplates(projectKey).catch((error) => {
          console.error("[GitHubAdapter] getIssueTemplates failed:", error);
          return { templates: [], blankIssuesEnabled: true };
        }),
      ]);
    return {
      labels,
      milestones,
      assignees,
      issueTypes,
      fields,
      templates: templateSet.templates,
      blankIssuesEnabled: templateSet.blankIssuesEnabled,
    };
  }

  /**
   * Looks assignable users up by login. GitHub has no user search scoped
   * to a repository, so the assignee list is filtered here.
   */
  async searchUsers(
    query: string,
    projectKey?: string,
    startAt: number = 0,
    maxResults: number = 50
  ): Promise<{
    users: Array<{
      accountId: string;
      displayName: string;
      emailAddress?: string;
      avatarUrls?: any;
    }>;
    total: number;
  }> {
    const assignees = await this.getAssignableUsers(projectKey ?? "");
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? assignees.filter((user) => user.name.toLowerCase().includes(needle))
      : assignees;
    return {
      users: matches.slice(startAt, startAt + maxResults).map((user) => ({
        accountId: user.id,
        displayName: user.name,
        avatarUrls: user.avatarUrl ? { "48x48": user.avatarUrl } : undefined,
      })),
      total: matches.length,
    };
  }

  /** Its issues are only ever open or closed. */
  async getStatuses(): Promise<Array<{ id: string; name: string }>> {
    return [...FIXED_TRACKER_STATUSES.GITHUB];
  }

  private mapStatusToGitHub(status: string): string {
    const lowerStatus = status.toLowerCase();
    if (
      lowerStatus === "closed" ||
      GITHUB_CLOSE_REASON_STATUSES.has(lowerStatus) ||
      lowerStatus === "done" ||
      lowerStatus === "resolved"
    ) {
      return "closed";
    }
    return "open";
  }

  private parseIssueRef(issueId: string): {
    owner: string;
    repo: string;
    issueNumber: string;
  } {
    let owner = this.owner;
    let repo = this.repo;
    let issueNumber = issueId;

    // Check if issueId includes repo context (format: "owner/repo#123")
    const repoIssueMatch = issueId.match(/^([^/]+)\/([^/#]+)#(\d+)$/);
    if (repoIssueMatch) {
      owner = repoIssueMatch[1];
      repo = repoIssueMatch[2];
      issueNumber = repoIssueMatch[3];
    } else if (issueId.startsWith("#")) {
      // Just a number with # prefix
      issueNumber = issueId.substring(1);
      if (!issueNumber || !/^\d+$/.test(issueNumber)) {
        throw new Error(`Invalid GitHub issue reference: ${issueId}`);
      }
    }

    if (!owner || !repo) {
      throw new Error(
        "GitHub repository not configured. Cannot fetch issue without owner/repo context."
      );
    }
    return { owner, repo, issueNumber };
  }

  /**
   * The ref for an issue GitHub returned as linked to one in `repository`.
   * The id names the issue's own repository, so `getIssue` reaches it even
   * when it lives somewhere else; the key stays short inside one repository.
   */
  private linkedIssueRef(
    linked: any,
    repository: string,
    linkType: string,
    direction: LinkedIssueRef["direction"]
  ): LinkedIssueRef | null {
    if (linked?.number == null) return null;
    const linkedRepository =
      (typeof linked.repository?.full_name === "string" &&
        linked.repository.full_name) ||
      (typeof linked.repository_url === "string" &&
        linked.repository_url.match(/\/repos\/([^/]+\/[^/]+)$/)?.[1]) ||
      repository;
    const id = `${linkedRepository}#${linked.number}`;
    return {
      id,
      key:
        linkedRepository.toLowerCase() === repository.toLowerCase()
          ? `#${linked.number}`
          : id,
      linkType,
      direction,
    };
  }

  /** One of an issue's link lists, each of which is an array of issues. */
  private async fetchIssueLinks(
    url: string,
    repository: string,
    linkType: string,
    direction: LinkedIssueRef["direction"]
  ): Promise<LinkedIssueRef[]> {
    const linked = await this.listAllPages<any>(
      url,
      {},
      { headers: GITHUB_REST_HEADERS }
    );
    return linked
      .map((issue) =>
        this.linkedIssueRef(issue, repository, linkType, direction)
      )
      .filter((ref): ref is LinkedIssueRef => ref !== null);
  }

  private async fetchCrossReferences(
    issueUrl: string,
    repository: string
  ): Promise<LinkedIssueRef[]> {
    const events = await this.listAllPages<any>(
      `${issueUrl}/timeline`,
      {},
      { headers: GITHUB_REST_HEADERS },
      MAX_TIMELINE_PAGES
    );
    const refs: LinkedIssueRef[] = [];
    for (const event of events) {
      if (event?.event !== "cross-referenced") continue;
      const ref = this.linkedIssueRef(
        event?.source?.issue,
        repository,
        "cross_referenced",
        "inward"
      );
      if (ref) refs.push(ref);
    }
    return refs;
  }

  private mapGitHubComments(response: any): IssueComment[] {
    if (!Array.isArray(response)) return [];
    const out: IssueComment[] = [];
    for (const c of response) {
      if (!c) continue;
      out.push({
        id: c.id != null ? String(c.id) : undefined,
        author: c.user?.login || "Unknown",
        body: c.body ?? "",
        created: c.created_at ?? "",
      });
    }
    return out;
  }

  private mapGitHubIssue(githubIssue: any): IssueData {
    // Extract owner/repo from repository_url (for search results) or html_url
    let owner = this.owner;
    let repo = this.repo;

    if (githubIssue.repository_url) {
      // Format: https://api.github.com/repos/owner/repo
      const match = githubIssue.repository_url.match(
        /\/repos\/([^/]+)\/([^/]+)$/
      );
      if (match) {
        owner = match[1];
        repo = match[2];
      }
    } else if (githubIssue.html_url) {
      // Format: https://github.com/owner/repo/issues/123
      const match = githubIssue.html_url.match(
        /github\.com\/([^/]+)\/([^/]+)\/issues/
      );
      if (match) {
        owner = match[1];
        repo = match[2];
      }
    }

    return {
      id: githubIssue.number.toString(),
      key: `#${githubIssue.number}`,
      title: githubIssue.title,
      description: githubIssue.body,
      status: githubIssueStatus(githubIssue) ?? githubIssue.state,
      priority: readIssuePriority(githubIssue.issue_field_values),
      assignee: githubIssue.assignee
        ? {
            id: githubIssue.assignee.login,
            name: githubIssue.assignee.login,
            email: githubIssue.assignee.email,
            avatarUrl: githubIssue.assignee.avatar_url,
          }
        : undefined,
      assignees: Array.isArray(githubIssue.assignees)
        ? githubIssue.assignees.map((user: any) => ({
            id: user.login,
            name: user.login,
            email: user.email,
            avatarUrl: user.avatar_url,
          }))
        : undefined,
      milestone: githubIssue.milestone
        ? {
            id: String(githubIssue.milestone.number),
            name: githubIssue.milestone.title,
            state: githubIssue.milestone.state,
            dueDate: githubIssue.milestone.due_on ?? undefined,
          }
        : undefined,
      commentCount:
        typeof githubIssue.comments === "number"
          ? githubIssue.comments
          : undefined,
      reporter: githubIssue.user
        ? {
            id: githubIssue.user.login,
            name: githubIssue.user.login,
            email: githubIssue.user.email,
          }
        : undefined,
      // Label names feed requirement classification (the designation
      // vocabulary for a tracker with no issue types), so this mapping is
      // load-bearing, guarded against payloads without a labels array,
      // and tolerant of GitHub's occasional plain-string label form.
      labels: Array.isArray(githubIssue.labels)
        ? githubIssue.labels.map((label: any) =>
            typeof label === "string" ? label : label.name
          )
        : [],
      labelColors: labelColorsOf(githubIssue.labels),
      // Issue field values by name, plus the repo context sync relies on.
      customFields: {
        ...readIssueFieldValues(githubIssue.issue_field_values),
        _github_owner: owner,
        _github_repo: repo,
      },
      createdAt: new Date(githubIssue.created_at),
      updatedAt: new Date(githubIssue.updated_at),
      url: githubIssue.html_url,
    };
  }

  async linkToTestCase(
    issueId: string,
    testCaseId: string,
    metadata?: any
  ): Promise<void> {
    const comment = `Linked to test case: ${testCaseId}${
      metadata ? `\n\nMetadata: ${JSON.stringify(metadata, null, 2)}` : ""
    }`;
    await this.addComment(issueId, comment);
  }

  async syncIssue(issueId: string): Promise<IssueData> {
    return this.getIssue(issueId);
  }
}
