import type { Page } from "@playwright/test";

/**
 * IDs resolved at runtime by fixtures.setup.ts and written to
 * .a11y-fixtures.json. Route `path` builders read from this so dynamic-segment
 * routes point at real, populated, seeded entities instead of guessed IDs.
 */
export interface A11yFixtures {
  projectId: number;
  caseId: number;
  caseId2: number;
  version: number;
  runId: number;
  sessionId: number;
  milestoneId: number;
  folderId: number;
  tagId: number;
  userId: string;
  shareKey?: string;
  datasetId?: number;
  providerId?: string;
}

/**
 * An interactive state to scan in addition to the page's initial render.
 * Implemented defensively in scan.spec.ts — a state that can't be reached is
 * recorded as "not reachable", never a hard failure.
 */
export type InteractiveState = "dialog" | "menu";

export interface A11yRoute {
  /** Unique kebab slug — also the per-route results filename. */
  name: string;
  /** Feature area, used for grouping in the report. */
  group: string;
  /** Locale-less path; the scanner prefixes the locale (e.g. "/en-US"). */
  path: (f: A11yFixtures) => string;
  /** When false, the route is scanned in a fresh unauthenticated context. */
  authRequired: boolean;
  /** CSS selector that must appear before scanning (proves the page rendered). */
  sanity?: string;
  /** Fixture keys this route needs; if any is missing the route is skipped. */
  needs?: (keyof A11yFixtures)[];
  /** This page may redirect for a logged-in admin — record the landed URL. */
  mayRedirect?: boolean;
  /** Cheap interactive states to additionally scan on this route. */
  interactions?: InteractiveState[];
  /** Optional extra wait (ms) for chart/editor-heavy pages to settle. */
  settleMs?: number;
}

// Sanity selectors kept intentionally loose: a top-level landmark proves the
// shell rendered without coupling the scan to specific feature markup.
const APP_SHELL = "main, [role='main'], body";
const FORM = "form, input, button";

export const routes: A11yRoute[] = [
  // ----- Public / auth (scanned logged-out) -----
  {
    name: "signin",
    group: "Auth",
    path: () => "/signin",
    authRequired: false,
    sanity: FORM,
  },
  {
    name: "signup",
    group: "Auth",
    path: () => "/signup",
    authRequired: false,
    sanity: FORM,
  },
  {
    name: "verify-email",
    group: "Auth",
    path: () => "/verify-email",
    authRequired: false,
    sanity: APP_SHELL,
    mayRedirect: true,
  },
  {
    name: "share-public",
    group: "Auth",
    path: (f) => `/share/${f.shareKey}`,
    authRequired: false,
    needs: ["shareKey"],
    sanity: APP_SHELL,
  },

  // ----- Special-state auth pages (may redirect for a normal admin session) -----
  {
    name: "two-factor-setup",
    group: "Auth (gated)",
    path: () => "/auth/two-factor-setup",
    authRequired: true,
    mayRedirect: true,
    sanity: APP_SHELL,
  },
  {
    name: "two-factor-verify",
    group: "Auth (gated)",
    path: () => "/auth/two-factor-verify",
    authRequired: true,
    mayRedirect: true,
    sanity: APP_SHELL,
  },
  {
    name: "force-change-password",
    group: "Auth (gated)",
    path: () => "/auth/force-change-password",
    authRequired: true,
    mayRedirect: true,
    sanity: APP_SHELL,
  },
  {
    name: "account-link-sso",
    group: "Auth (gated)",
    path: () => "/account/link-sso",
    authRequired: true,
    mayRedirect: true,
    sanity: APP_SHELL,
  },
  {
    name: "trial-expired",
    group: "Auth (gated)",
    path: () => "/trial-expired",
    authRequired: true,
    mayRedirect: true,
    sanity: APP_SHELL,
  },

  // ----- Dashboard / global -----
  {
    name: "home",
    group: "Dashboard",
    path: () => "/",
    authRequired: true,
    sanity: APP_SHELL,
    mayRedirect: true,
  },
  {
    name: "reviews",
    group: "Dashboard",
    path: () => "/reviews",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "issues-global",
    group: "Dashboard",
    path: () => "/issues",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "tags-global",
    group: "Dashboard",
    path: () => "/tags",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "tag-global-detail",
    group: "Dashboard",
    path: (f) => `/tags/${f.tagId}`,
    authRequired: true,
    needs: ["tagId"],
    sanity: APP_SHELL,
    mayRedirect: true,
  },
  {
    name: "users-global",
    group: "Dashboard",
    path: () => "/users",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "user-profile",
    group: "Dashboard",
    path: (f) => `/users/profile/${f.userId}`,
    authRequired: true,
    needs: ["userId"],
    sanity: APP_SHELL,
  },

  // ----- Projects -----
  {
    name: "projects-list",
    group: "Projects",
    path: () => "/projects",
    authRequired: true,
    sanity: APP_SHELL,
    interactions: ["dialog"],
  },
  {
    name: "project-overview",
    group: "Projects",
    path: (f) => `/projects/overview/${f.projectId}`,
    authRequired: true,
    needs: ["projectId"],
    sanity: APP_SHELL,
  },
  {
    name: "project-documentation",
    group: "Projects",
    path: (f) => `/projects/documentation/${f.projectId}`,
    authRequired: true,
    needs: ["projectId"],
    sanity: APP_SHELL,
  },
  {
    name: "project-issues",
    group: "Projects",
    path: (f) => `/projects/issues/${f.projectId}`,
    authRequired: true,
    needs: ["projectId"],
    sanity: APP_SHELL,
  },

  // ----- Repository / test cases -----
  {
    name: "repository-list",
    group: "Repository",
    path: (f) => `/projects/repository/${f.projectId}`,
    authRequired: true,
    needs: ["projectId"],
    sanity: APP_SHELL,
    interactions: ["dialog", "menu"],
  },
  {
    name: "case-detail",
    group: "Repository",
    path: (f) => `/projects/repository/${f.projectId}/${f.caseId}`,
    authRequired: true,
    needs: ["projectId", "caseId"],
    sanity: APP_SHELL,
    settleMs: 1500,
    interactions: ["menu"],
  },
  {
    name: "case-detail-2",
    group: "Repository",
    path: (f) => `/projects/repository/${f.projectId}/${f.caseId2}`,
    authRequired: true,
    needs: ["projectId", "caseId2"],
    sanity: APP_SHELL,
    settleMs: 1500,
  },
  {
    name: "case-version",
    group: "Repository",
    path: (f) => `/projects/repository/${f.projectId}/${f.caseId}/${f.version}`,
    authRequired: true,
    needs: ["projectId", "caseId", "version"],
    sanity: APP_SHELL,
    mayRedirect: true,
  },
  {
    name: "case-global",
    group: "Repository",
    path: (f) => `/case/${f.caseId}`,
    authRequired: true,
    needs: ["caseId"],
    sanity: APP_SHELL,
    mayRedirect: true,
  },
  {
    name: "repository-duplicates",
    group: "Repository",
    path: (f) => `/projects/repository/${f.projectId}/duplicates`,
    authRequired: true,
    needs: ["projectId"],
    sanity: APP_SHELL,
  },

  // ----- Test runs -----
  {
    name: "runs-list",
    group: "Test Runs",
    path: (f) => `/projects/runs/${f.projectId}`,
    authRequired: true,
    needs: ["projectId"],
    sanity: APP_SHELL,
    interactions: ["dialog"],
  },
  {
    name: "run-detail",
    group: "Test Runs",
    path: (f) => `/projects/runs/${f.projectId}/${f.runId}`,
    authRequired: true,
    needs: ["projectId", "runId"],
    sanity: APP_SHELL,
    settleMs: 1000,
    interactions: ["menu"],
  },

  // ----- Sessions -----
  {
    name: "sessions-list",
    group: "Sessions",
    path: (f) => `/projects/sessions/${f.projectId}`,
    authRequired: true,
    needs: ["projectId"],
    sanity: APP_SHELL,
    interactions: ["dialog"],
  },
  {
    name: "session-detail",
    group: "Sessions",
    path: (f) => `/projects/sessions/${f.projectId}/${f.sessionId}`,
    authRequired: true,
    needs: ["projectId", "sessionId"],
    sanity: APP_SHELL,
    settleMs: 1000,
  },
  {
    name: "session-version",
    group: "Sessions",
    path: (f) =>
      `/projects/sessions/${f.projectId}/${f.sessionId}/${f.version}`,
    authRequired: true,
    needs: ["projectId", "sessionId", "version"],
    sanity: APP_SHELL,
    mayRedirect: true,
  },

  // ----- Milestones -----
  {
    name: "milestones-list",
    group: "Milestones",
    path: (f) => `/projects/milestones/${f.projectId}`,
    authRequired: true,
    needs: ["projectId"],
    sanity: APP_SHELL,
    interactions: ["dialog"],
  },
  {
    name: "milestone-detail",
    group: "Milestones",
    path: (f) => `/projects/milestones/${f.projectId}/${f.milestoneId}`,
    authRequired: true,
    needs: ["projectId", "milestoneId"],
    sanity: APP_SHELL,
  },
  {
    name: "milestone-global",
    group: "Milestones",
    path: (f) => `/milestone/${f.milestoneId}`,
    authRequired: true,
    needs: ["milestoneId"],
    sanity: APP_SHELL,
    mayRedirect: true,
  },

  // ----- Project settings -----
  {
    name: "settings-integrations",
    group: "Project Settings",
    path: (f) => `/projects/settings/${f.projectId}/integrations`,
    authRequired: true,
    needs: ["projectId"],
    sanity: APP_SHELL,
  },
  {
    name: "settings-ai-models",
    group: "Project Settings",
    path: (f) => `/projects/settings/${f.projectId}/ai-models`,
    authRequired: true,
    needs: ["projectId"],
    sanity: APP_SHELL,
  },
  {
    name: "settings-parameters",
    group: "Project Settings",
    path: (f) => `/projects/settings/${f.projectId}/parameters`,
    authRequired: true,
    needs: ["projectId"],
    sanity: APP_SHELL,
  },
  {
    name: "settings-datasets",
    group: "Project Settings",
    path: (f) => `/projects/settings/${f.projectId}/datasets`,
    authRequired: true,
    needs: ["projectId"],
    sanity: APP_SHELL,
  },
  {
    name: "settings-dataset-detail",
    group: "Project Settings",
    path: (f) => `/projects/settings/${f.projectId}/datasets/${f.datasetId}`,
    authRequired: true,
    needs: ["projectId", "datasetId"],
    sanity: APP_SHELL,
    mayRedirect: true,
  },
  {
    name: "settings-junit",
    group: "Project Settings",
    path: (f) => `/projects/settings/${f.projectId}/junit`,
    authRequired: true,
    needs: ["projectId"],
    sanity: APP_SHELL,
  },
  {
    name: "settings-quickscript",
    group: "Project Settings",
    path: (f) => `/projects/settings/${f.projectId}/quickscript`,
    authRequired: true,
    needs: ["projectId"],
    sanity: APP_SHELL,
  },
  {
    name: "settings-webhooks",
    group: "Project Settings",
    path: (f) => `/projects/settings/${f.projectId}/webhooks`,
    authRequired: true,
    needs: ["projectId"],
    sanity: APP_SHELL,
  },
  {
    name: "settings-shares",
    group: "Project Settings",
    path: (f) => `/projects/settings/${f.projectId}/shares`,
    authRequired: true,
    needs: ["projectId"],
    sanity: APP_SHELL,
  },
  {
    name: "settings-advanced",
    group: "Project Settings",
    path: (f) => `/projects/settings/${f.projectId}/advanced`,
    authRequired: true,
    needs: ["projectId"],
    sanity: APP_SHELL,
  },

  // ----- Shared steps -----
  {
    name: "shared-steps",
    group: "Shared Steps",
    path: (f) => `/projects/shared-steps/${f.projectId}`,
    authRequired: true,
    needs: ["projectId"],
    sanity: APP_SHELL,
  },
  {
    name: "shared-steps-duplicates",
    group: "Shared Steps",
    path: (f) => `/projects/shared-steps/${f.projectId}/step-duplicates`,
    authRequired: true,
    needs: ["projectId"],
    sanity: APP_SHELL,
  },

  // ----- Project tags / reports -----
  {
    name: "project-tags",
    group: "Tags & Reports",
    path: (f) => `/projects/tags/${f.projectId}`,
    authRequired: true,
    needs: ["projectId"],
    sanity: APP_SHELL,
  },
  {
    name: "project-tag-detail",
    group: "Tags & Reports",
    path: (f) => `/projects/tags/${f.projectId}/${f.tagId}`,
    authRequired: true,
    needs: ["projectId", "tagId"],
    sanity: APP_SHELL,
    mayRedirect: true,
  },
  {
    name: "project-reports",
    group: "Tags & Reports",
    path: (f) => `/projects/reports/${f.projectId}`,
    authRequired: true,
    needs: ["projectId"],
    sanity: APP_SHELL,
    settleMs: 1500,
  },

  // ----- Admin -----
  {
    name: "admin-home",
    group: "Admin",
    path: () => "/admin",
    authRequired: true,
    sanity: APP_SHELL,
    mayRedirect: true,
  },
  {
    name: "admin-users",
    group: "Admin",
    path: () => "/admin/users",
    authRequired: true,
    sanity: APP_SHELL,
    interactions: ["dialog", "menu"],
  },
  {
    name: "admin-groups",
    group: "Admin",
    path: () => "/admin/groups",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-roles",
    group: "Admin",
    path: () => "/admin/roles",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-sso",
    group: "Admin",
    path: () => "/admin/sso",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-integrations",
    group: "Admin",
    path: () => "/admin/integrations",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-issues",
    group: "Admin",
    path: () => "/admin/issues",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-code-repositories",
    group: "Admin",
    path: () => "/admin/code-repositories",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-api-tokens",
    group: "Admin",
    path: () => "/admin/api-tokens",
    authRequired: true,
    sanity: APP_SHELL,
    interactions: ["dialog"],
  },
  {
    name: "admin-llm",
    group: "Admin",
    path: () => "/admin/llm",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-prompts",
    group: "Admin",
    path: () => "/admin/prompts",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-quickscripts",
    group: "Admin",
    path: () => "/admin/quickscripts",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-elasticsearch",
    group: "Admin",
    path: () => "/admin/elasticsearch",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-fields",
    group: "Admin",
    path: () => "/admin/fields",
    authRequired: true,
    sanity: APP_SHELL,
    interactions: ["dialog"],
  },
  {
    name: "admin-configurations",
    group: "Admin",
    path: () => "/admin/configurations",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-security",
    group: "Admin",
    path: () => "/admin/security",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-app-config",
    group: "Admin",
    path: () => "/admin/app-config",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-statuses",
    group: "Admin",
    path: () => "/admin/statuses",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-tags",
    group: "Admin",
    path: () => "/admin/tags",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-shares",
    group: "Admin",
    path: () => "/admin/shares",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-notifications",
    group: "Admin",
    path: () => "/admin/notifications",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-workflows",
    group: "Admin",
    path: () => "/admin/workflows",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-audit-logs",
    group: "Admin",
    path: () => "/admin/audit-logs",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-trash",
    group: "Admin",
    path: () => "/admin/trash",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-imports",
    group: "Admin",
    path: () => "/admin/imports",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-projects",
    group: "Admin",
    path: () => "/admin/projects",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-milestones",
    group: "Admin",
    path: () => "/admin/milestones",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-queues",
    group: "Admin",
    path: () => "/admin/queues",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-reports",
    group: "Admin",
    path: () => "/admin/reports",
    authRequired: true,
    sanity: APP_SHELL,
  },
  {
    name: "admin-sso-saml",
    group: "Admin",
    path: (f) => `/admin/sso/saml/${f.providerId}`,
    authRequired: true,
    needs: ["providerId"],
    sanity: APP_SHELL,
    mayRedirect: true,
  },

  // ----- Docs -----
  {
    name: "docs-api",
    group: "Docs",
    path: () => "/docs/api",
    authRequired: true,
    sanity: APP_SHELL,
  },
];

/** Helper for the spec/aggregator: which routes are interactive-state scanned. */
export function hasInteractions(route: A11yRoute): boolean {
  return !!route.interactions && route.interactions.length > 0;
}

export type { Page };
