/**
 * API Token Authentication
 *
 * Provides authentication for API requests using Bearer tokens.
 * This is used by API routes to authenticate external API access.
 */

import { NextRequest } from "next/server";
import { prisma } from "./prisma";
import { hashToken, isValidTokenFormat } from "./api-tokens";

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
  errorCode?: "NO_TOKEN" | "INVALID_FORMAT" | "INVALID_TOKEN" | "EXPIRED_TOKEN" | "INACTIVE_TOKEN" | "INACTIVE_USER" | "API_ACCESS_DISABLED";
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

  // Hash the token to look up in database
  const tokenHash = hashToken(token);

  // Look up the token
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

  // Update last used timestamp (async, don't block the response)
  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
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
