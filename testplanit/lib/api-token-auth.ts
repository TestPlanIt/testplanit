/**
 * API Token Authentication
 *
 * Provides authentication for API requests using Bearer tokens.
 * This is used by API routes to authenticate external API access.
 */

import { NextRequest } from "next/server";
import {
  getCachedTokenInfo,
  invalidateApiTokenCache,
  setCachedTokenInfo,
} from "./api-token-cache";
import { hashToken, isValidTokenFormat } from "./api-tokens";
import { prisma } from "./prisma";

// Re-export so callers that previously imported from api-token-auth keep working.
export { invalidateApiTokenCache };

export interface ApiTokenAuthResult {
  /** Whether authentication was successful */
  authenticated: boolean;
  /** The authenticated user ID (if successful) */
  userId?: string;
  /** The user's access level */
  access?: string;
  /** Token scopes (empty array means full access based on user permissions) */
  scopes?: string[];
  /** Error message (if authentication failed) */
  error?: string;
  /** Error code for programmatic handling */
  errorCode?:
    | "NO_TOKEN"
    | "INVALID_FORMAT"
    | "INVALID_TOKEN"
    | "EXPIRED_TOKEN"
    | "INACTIVE_TOKEN"
    | "INACTIVE_USER"
    | "API_ACCESS_DISABLED"
    | "READ_ONLY_TOKEN";
}

/**
 * HTTP methods that mutate state. Used by `authenticateApiTokenForMethod`
 * to gate `mode:read` tokens. Set + uppercase letters because Next.js
 * NextRequest.method is always uppercase.
 */
const WRITE_HTTP_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Returns true when the token's scopes narrow it to read-only operations.
 * Recognized scope tag: `mode:read` (see schema.zmodel + packages/mcp-server/README.md).
 */
export function isReadOnly(scopes: string[] | undefined): boolean {
  return Boolean(scopes?.includes("mode:read"));
}

/**
 * Returns true when the token's scopes mark it as MCP-attributable.
 * Recognized scope tag: `client:mcp` (see schema.zmodel + packages/mcp-server/README.md).
 */
export function isMcpClient(scopes: string[] | undefined): boolean {
  return Boolean(scopes?.includes("client:mcp"));
}

/**
 * Extract Bearer token from Authorization header
 */
export function extractBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.substring(7).trim();
}

/**
 * Authenticate an API request using Bearer token
 *
 * @param request - The Next.js request object
 * @returns Authentication result with user info or error
 */
export async function authenticateApiToken(
  request: NextRequest
): Promise<ApiTokenAuthResult> {
  const token = extractBearerToken(request);

  if (!token) {
    return {
      authenticated: false,
      error: "No Bearer token provided",
      errorCode: "NO_TOKEN",
    };
  }

  if (!isValidTokenFormat(token)) {
    return {
      authenticated: false,
      error: "Invalid token format",
      errorCode: "INVALID_FORMAT",
    };
  }

  // Hash the token to look up in database/cache
  const tokenHash = hashToken(token);

  // Fast path: cached lookup (saves a DB query per request under load).
  const cached = await getCachedTokenInfo(tokenHash);
  if (cached) {
    // Revalidate expiration inline (clock may have advanced since we cached).
    if (cached.expiresAt && new Date(cached.expiresAt) < new Date()) {
      await invalidateApiTokenCache(tokenHash);
      return {
        authenticated: false,
        error: "API token has expired",
        errorCode: "EXPIRED_TOKEN",
      };
    }

    // Update lastUsedAt asynchronously, same as the slow path.
    const clientIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    prisma.apiToken
      .update({
        where: { id: cached.tokenId },
        data: { lastUsedAt: new Date(), lastUsedIp: clientIp },
      })
      .catch((err) => {
        console.error("Failed to update API token last used:", err);
      });

    return {
      authenticated: true,
      userId: cached.userId,
      access: cached.userAccess ?? undefined,
      scopes: cached.scopes,
    };
  }

  // Slow path: DB lookup, validate everything, populate cache on success.
  const apiToken = await prisma.apiToken.findUnique({
    where: { token: tokenHash },
    include: {
      user: {
        select: {
          id: true,
          access: true,
          isActive: true,
          isDeleted: true,
          isApi: true,
        },
      },
    },
  });

  if (!apiToken) {
    return {
      authenticated: false,
      error: "Invalid API token",
      errorCode: "INVALID_TOKEN",
    };
  }

  // Check if token is active
  if (!apiToken.isActive) {
    return {
      authenticated: false,
      error: "API token has been revoked",
      errorCode: "INACTIVE_TOKEN",
    };
  }

  // Check if token has expired
  if (apiToken.expiresAt && apiToken.expiresAt < new Date()) {
    return {
      authenticated: false,
      error: "API token has expired",
      errorCode: "EXPIRED_TOKEN",
    };
  }

  // Check if user is active
  if (!apiToken.user.isActive || apiToken.user.isDeleted) {
    return {
      authenticated: false,
      error: "User account is inactive",
      errorCode: "INACTIVE_USER",
    };
  }

  // Check if user has API access enabled
  if (!apiToken.user.isApi) {
    return {
      authenticated: false,
      error: "API access is disabled for this user",
      errorCode: "API_ACCESS_DISABLED",
    };
  }

  // Cache the successful lookup for subsequent requests.
  await setCachedTokenInfo(tokenHash, {
    tokenId: apiToken.id,
    userId: apiToken.userId,
    userAccess: apiToken.user.access ?? null,
    scopes: apiToken.scopes,
    expiresAt: apiToken.expiresAt ? apiToken.expiresAt.toISOString() : null,
  });

  // Update last used timestamp (async, don't block the response)
  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  prisma.apiToken
    .update({
      where: { id: apiToken.id },
      data: {
        lastUsedAt: new Date(),
        lastUsedIp: clientIp,
      },
    })
    .catch((err) => {
      console.error("Failed to update API token last used:", err);
    });

  return {
    authenticated: true,
    userId: apiToken.userId,
    access: apiToken.user.access,
    scopes: apiToken.scopes,
  };
}

/**
 * Check if a request has a Bearer token (without validating it)
 * Used by middleware to detect API token requests
 */
export function hasBearerToken(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  return authHeader?.startsWith("Bearer tpi_") ?? false;
}

export interface AuthenticatedUser {
  userId: string;
  access?: string | null;
}

/**
 * Authenticate a request using session first, falling back to API token.
 *
 * Use this in custom API routes that need to support both browser sessions
 * and programmatic API token access (CI/CD, load testing, external tools).
 *
 * @param request - The Next.js request object (needed for API token extraction)
 * @param session - The result of getServerSession(authOptions) or getServerAuthSession()
 * @returns The authenticated user info, or null if neither auth method succeeds
 */
export async function authenticateRequest(
  request: NextRequest,
  session: {
    user?: { id?: string; access?: string | null; [key: string]: unknown };
  } | null
): Promise<
  | { authenticated: true; user: AuthenticatedUser }
  | { authenticated: false; error: string; errorCode?: string; status: number }
> {
  // Try session auth first
  if (session?.user?.id) {
    return {
      authenticated: true,
      user: { userId: session.user.id, access: session.user.access },
    };
  }

  // Fall back to API token
  const token = extractBearerToken(request);
  if (!token) {
    return {
      authenticated: false,
      error: "Unauthorized",
      status: 401,
    };
  }

  const apiAuth = await authenticateApiToken(request);
  if (!apiAuth.authenticated) {
    return {
      authenticated: false,
      error: apiAuth.error ?? "Unauthorized",
      errorCode: apiAuth.errorCode,
      status: 401,
    };
  }

  return {
    authenticated: true,
    user: { userId: apiAuth.userId!, access: apiAuth.access },
  };
}

/**
 * Authenticate an API request using a Bearer token, then enforce
 * `mode:read` against the request's HTTP method.
 *
 * Wraps `authenticateApiToken`: if the underlying call fails, the original
 * errorCode is returned unchanged (so an `INVALID_TOKEN` is never masked
 * as `READ_ONLY_TOKEN` — see T-05-01). On a successful auth, write-method
 * requests (POST/PUT/PATCH/DELETE) made with a `mode:read` token are
 * rejected with `errorCode: "READ_ONLY_TOKEN"`. Reads pass through.
 *
 * Used by mutation routes; non-mutation routes can keep calling
 * `authenticateApiToken` directly.
 */
export async function authenticateApiTokenForMethod(
  request: NextRequest
): Promise<ApiTokenAuthResult> {
  const result = await authenticateApiToken(request);
  if (!result.authenticated) {
    return result;
  }

  if (WRITE_HTTP_METHODS.has(request.method) && isReadOnly(result.scopes)) {
    // Note: error message intentionally does NOT echo the raw token (T-05-06).
    return {
      authenticated: false,
      error: "Token is read-only; write operations are not permitted.",
      errorCode: "READ_ONLY_TOKEN",
    };
  }

  return result;
}
