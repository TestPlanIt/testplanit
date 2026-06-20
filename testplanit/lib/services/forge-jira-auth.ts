/**
 * Shared authentication + identity helpers for the Forge (Jira panel) write
 * endpoints under `app/api/integrations/jira/`.
 *
 * Trust model (matches the existing `test-info` read endpoint):
 *  - The Forge backend authenticates the *integration* with the shared
 *    `X-Forge-Api-Key`, validated constant-time against the stored key.
 *  - The Forge backend additionally forwards the current Jira user's email
 *    (read server-side from `/myself`) so writes can be attributed to a real
 *    TestPlanIt user. That email rides on the same API-key-authenticated
 *    channel — it is not an independent trust anchor.
 *
 * Because the email is asserted by the Forge backend, every write path still
 * enforces that the mapped user actually has access to the target project.
 */

import { prisma as db } from "@/lib/prisma";
import { IntegrationProvider, ProjectAccessType } from "~/zenstack/models";
import { createHmac, timingSafeEqual } from "crypto";

/** CORS headers shared by the Forge endpoints (mirrors `test-info`). */
export const FORGE_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Forge-Api-Key, X-Forge-User-Email, X-Forge-User-Account-Id, X-Forge-Token",
} as const;

function constantTimeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Validate the `X-Forge-Api-Key` against the stored key on any non-deleted
 * Jira integration. Returns the matching integration id, or null when the
 * key is missing/invalid.
 */
export async function authenticateForgeIntegration(
  apiKey: string | null
): Promise<{ id: number } | null> {
  if (!apiKey) return null;

  const jiraIntegrations = await db.integration.findMany({
    where: {
      provider: IntegrationProvider.JIRA,
      isDeleted: false,
    },
    select: {
      id: true,
      settings: true,
    },
  });

  const match = jiraIntegrations.find((integration) => {
    const settings = integration.settings as Record<string, unknown> | null;
    const storedKey = settings?.forgeApiKey as string | undefined;
    if (!storedKey) return false;
    return constantTimeCompare(storedKey, apiKey);
  });

  return match ? { id: match.id } : null;
}

export interface ForgeUser {
  id: string;
  name: string;
  email: string;
  access: string;
}

/**
 * Resolve the forwarded Jira identity to an active TestPlanIt user. Email is
 * the primary match key (`User.email` is unique); the Atlassian account id is
 * a fallback against `User.externalId` for installs that have populated it via
 * SSO mapping. Returns null when no active user matches.
 */
export async function resolveForgeUser(identity: {
  email: string | null;
  accountId: string | null;
}): Promise<ForgeUser | null> {
  const email = identity.email?.trim().toLowerCase();
  const accountId = identity.accountId?.trim();

  let user: {
    id: string;
    name: string;
    email: string;
    access: string;
  } | null = null;

  if (email) {
    user = await db.user.findFirst({
      where: { email, isActive: true, isDeleted: false },
      select: { id: true, name: true, email: true, access: true },
    });
  }

  if (!user && accountId) {
    user = await db.user.findFirst({
      where: { externalId: accountId, isActive: true, isDeleted: false },
      select: { id: true, name: true, email: true, access: true },
    });
  }

  return user;
}

/**
 * Whether `user` may generate/create test cases in `projectId`. Mirrors the
 * project-access where clause used by `/api/llm/generate-test-cases` so the
 * Forge path enforces exactly the same access paths (direct user permissions,
 * group permissions, GLOBAL_ROLE default, and PROJECTADMIN assignment).
 */
export async function forgeUserHasProjectAccess(
  user: ForgeUser,
  projectId: number
): Promise<boolean> {
  const isAdmin = user.access === "ADMIN";
  const isProjectAdmin = user.access === "PROJECTADMIN";

  const where = isAdmin
    ? { id: projectId, isDeleted: false }
    : {
        id: projectId,
        isDeleted: false,
        OR: [
          {
            userPermissions: {
              some: {
                userId: user.id,
                accessType: { not: ProjectAccessType.NO_ACCESS },
              },
            },
          },
          {
            groupPermissions: {
              some: {
                group: {
                  assignedUsers: {
                    some: { userId: user.id },
                  },
                },
                accessType: { not: ProjectAccessType.NO_ACCESS },
              },
            },
          },
          {
            defaultAccessType: ProjectAccessType.GLOBAL_ROLE,
          },
          ...(isProjectAdmin
            ? [
                {
                  assignedUsers: {
                    some: { userId: user.id },
                  },
                },
              ]
            : []),
        ],
      };

  const project = await db.projects.findFirst({ where, select: { id: true } });
  return !!project;
}

/**
 * One-call gate for the Forge write endpoints: validate the API key, map the
 * forwarded Jira user, and (optionally) enforce project access. Returns a
 * discriminated result the route maps to a JSON response.
 */
export type ForgeAuthResult =
  | { ok: true; integrationId: number; user: ForgeUser }
  | { ok: false; status: number; error: string };

export async function authenticateForgeWrite(
  request: Request,
  options?: { projectId?: number }
): Promise<ForgeAuthResult> {
  const integration = await authenticateForgeIntegration(
    request.headers.get("X-Forge-Api-Key")
  );
  if (!integration) {
    return {
      ok: false,
      status: 401,
      error:
        "Invalid or missing API key. Configure a Forge API key in your Jira integration settings.",
    };
  }

  const user = await resolveForgeUser({
    email: request.headers.get("X-Forge-User-Email"),
    accountId: request.headers.get("X-Forge-User-Account-Id"),
  });
  if (!user) {
    return {
      ok: false,
      status: 403,
      error:
        "Your Jira account isn't linked to a TestPlanIt user. Sign in to TestPlanIt with the same email, then try again.",
    };
  }

  if (options?.projectId !== undefined) {
    const hasAccess = await forgeUserHasProjectAccess(user, options.projectId);
    if (!hasAccess) {
      return {
        ok: false,
        status: 403,
        error: "You don't have access to the selected TestPlanIt project.",
      };
    }
  }

  return { ok: true, integrationId: integration.id, user };
}

// ---------------------------------------------------------------------------
// Short-lived stream token
//
// LLM generation exceeds Forge's 25s function limit, so the panel streams it
// from the browser directly (a browser fetch isn't bound by that limit). The
// browser can't hold the forge API key, so the forge-key-authenticated resolver
// asks TestPlanIt to mint a short-lived HMAC token bound to the resolved
// user/integration/project/issue. The streaming endpoint verifies that token
// instead of the API key. The token rides the same trust anchor (it's only
// minted after a valid forge-key + user check) and expires quickly.
// ---------------------------------------------------------------------------

const STREAM_TOKEN_TTL_MS = 120_000;

export interface ForgeStreamTokenPayload {
  userId: string;
  integrationId: number;
  projectId: number;
  issueKey: string | null;
  issueId: string | null;
}

function streamTokenSecret(): string {
  // Reuse the app's existing server secret; the token only needs to be
  // unforgeable by the browser, not a long-lived credential.
  return process.env.NEXTAUTH_SECRET || "";
}

export function mintForgeStreamToken(payload: ForgeStreamTokenPayload): string {
  const body = { ...payload, exp: Date.now() + STREAM_TOKEN_TTL_MS };
  const data = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = createHmac("sha256", streamTokenSecret())
    .update(data)
    .digest("base64url");
  return `${data}.${sig}`;
}

export function verifyForgeStreamToken(
  token: string | null
): (ForgeStreamTokenPayload & { exp: number }) | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = createHmac("sha256", streamTokenSecret())
    .update(data)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const body = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (typeof body.exp !== "number" || body.exp < Date.now()) return null;
    return body;
  } catch {
    return null;
  }
}
