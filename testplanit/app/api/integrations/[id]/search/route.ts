import { getEnhancedDb } from "@/lib/auth/utils";
import { baseDb } from "@/lib/db";
import { IntegrationManager } from "@/lib/integrations/IntegrationManager";
import {
  integrationErrorBody,
  oauthReauthorizeUrl,
  reauthorizationBody,
  responseStatusForIntegrationError,
  toIntegrationError,
} from "~/lib/integrations/errors";
import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";
import { authOptions } from "~/server/auth";
import { withRequestRouting } from "~/lib/db/requestRouting";
import { usesIntegrationCredentials } from "~/lib/integrations/authTypes";

async function handleGET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");
  const projectId = searchParams.get("projectId");

  if (!query) {
    return Response.json(
      { error: "Query parameter is required" },
      { status: 400 }
    );
  }

  // Backstop for the client-side 255-char cap: an oversized term would be
  // forwarded into the tracker's GET URL and bounce off URL-length limits
  // (CloudFront 414) — reject with a clean message instead.
  if (query.length > 512) {
    return Response.json(
      { error: "Search query is too long (max 512 characters)" },
      { status: 400 }
    );
  }

  // Known once the integration is loaded; the outer catch needs both to name
  // the provider and to offer OAuth users a reconnect link.
  let provider = "";
  let oauthKickoffUrl: string | undefined;

  try {
    const db = await getEnhancedDb(session);
    const { id } = await params;
    const integrationId = parseInt(id);

    // Get the integration with user auth
    const integration = await db.integration.findUnique({
      where: { id: integrationId },
      include: {
        userIntegrationAuths: {
          where: { userId: session.user.id, isActive: true },
        },
      },
    });

    if (!integration) {
      return Response.json({ error: "Integration not found" }, { status: 404 });
    }

    provider = integration.provider;
    const usesStoredCredentials = usesIntegrationCredentials(
      integration.authType
    );
    // Only OAuth integrations can be repaired by the user re-authorizing;
    // expired API keys/PATs are fixed by an admin on the integration.
    if (!usesStoredCredentials) {
      oauthKickoffUrl = oauthReauthorizeUrl(
        integration.provider,
        integrationId
      );
    }

    // Check authentication based on integration type
    if (usesStoredCredentials) {
      // For API key/PAT integrations, authentication is stored in the integration itself
      const stored = await baseDb.integration.findUnique({
        where: { id: integrationId },
        select: { credentials: true },
      });
      if (!stored?.credentials) {
        return Response.json(
          {
            error: "API key or Personal Access Token not configured",
            requiresAuth: true,
          },
          { status: 401 }
        );
      }
    } else {
      // For OAuth integrations, check user-specific auth
      const userAuth = integration.userIntegrationAuths[0];
      if (!userAuth || !userAuth.accessToken || userAuth.needsReauthAt) {
        // Point the client at the internal OAuth kickoff route: it generates
        // AND stores the state parameter the callback verifies. Handing out
        // the provider's raw authorize URL here skipped that step, so every
        // authorization bounced off the callback with invalid_state.
        return Response.json(
          {
            error: "Authentication required",
            authUrl: oauthKickoffUrl,
            requiresAuth: true,
          },
          { status: 401 }
        );
      }
    }

    // Search issues using the adapter. OAuth searches run on the caller's own
    // token (the check above guarantees they have one), so another user's
    // dead token cannot break their search.
    const manager = IntegrationManager.getInstance();
    const adapter = await manager.getAdapter(
      integrationId.toString(),
      undefined,
      usesStoredCredentials ? undefined : session.user.id
    );

    if (!adapter) {
      return Response.json({ error: "Adapter not found" }, { status: 404 });
    }

    // If projectId is provided, use it to filter the search
    const searchOptions: any = {
      query,
      maxResults: 20,
    };

    if (projectId) {
      searchOptions.projectId = projectId;
    }

    const searchResult = await adapter.searchIssues(searchOptions);

    // Handle both array and object return types
    const issues = Array.isArray(searchResult)
      ? searchResult
      : searchResult.issues || [];
    const total = Array.isArray(searchResult)
      ? searchResult.length
      : searchResult.total || issues.length;

    return Response.json({
      issues,
      total,
    });
  } catch (error: any) {
    console.error("Search error:", error);

    // Rejected OAuth credentials — whether building the adapter (dead refresh
    // token) or running the search — are fixed by the user reconnecting.
    const reauthorization = reauthorizationBody(
      error,
      provider,
      oauthKickoffUrl
    );
    if (reauthorization) {
      return Response.json(reauthorization, { status: 401 });
    }

    // Responding with the typed error's `userMessage` rather than
    // `error.message` keeps adapter internals and upstream response bodies
    // out of the client.
    const integrationError = toIntegrationError(error, provider);
    return Response.json(integrationErrorBody(integrationError), {
      status: responseStatusForIntegrationError(integrationError),
    });
  }
}

export const GET = withRequestRouting(handleGET);
