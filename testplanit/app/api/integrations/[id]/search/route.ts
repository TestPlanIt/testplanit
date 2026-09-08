import { getEnhancedDb } from "@/lib/auth/utils";
import { IntegrationManager } from "@/lib/integrations/IntegrationManager";
import {
  integrationErrorBody,
  responseStatusForIntegrationError,
  toIntegrationError,
} from "~/lib/integrations/errors";
import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";
import { authOptions } from "~/server/auth";

// The search dialog opens this URL in a popup, so the callback should land on
// the neutral auth-complete page (accessible to every signed-in user), not an
// admin-only settings page.
const buildOAuthKickoffUrl = (provider: string, integrationId: number) =>
  `/api/integrations/oauth/${provider.toLowerCase()}/auth?integrationId=${integrationId}&returnUrl=${encodeURIComponent("/integrations/auth-complete")}`;

export async function GET(
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

  try {
    const db = await getEnhancedDb(session);
    const { id } = await params;
    const integrationId = parseInt(id);

    // Get the integration with user auth
    const integration = await db.integration.findUnique({
      where: { id: integrationId },
      include: {
        userIntegrationAuths: {
          where: { userId: session.user.id },
        },
      },
    });

    if (!integration) {
      return Response.json({ error: "Integration not found" }, { status: 404 });
    }

    // Check authentication based on integration type
    if (
      integration.authType === "API_KEY" ||
      integration.authType === "PERSONAL_ACCESS_TOKEN"
    ) {
      // For API key/PAT integrations, authentication is stored in the integration itself
      if (!integration.credentials) {
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
      if (!userAuth || !userAuth.accessToken) {
        // Point the client at the internal OAuth kickoff route: it generates
        // AND stores the state parameter the callback verifies. Handing out
        // the provider's raw authorize URL here skipped that step, so every
        // authorization bounced off the callback with invalid_state.
        return Response.json(
          {
            error: "Authentication required",
            authUrl: buildOAuthKickoffUrl(integration.provider, integrationId),
            requiresAuth: true,
          },
          { status: 401 }
        );
      }
    }

    // Search issues using the adapter
    const manager = IntegrationManager.getInstance();
    const adapter = await manager.getAdapter(integrationId.toString());

    if (!adapter) {
      return Response.json({ error: "Adapter not found" }, { status: 404 });
    }

    // Set authentication based on integration type
    if (
      integration.authType === "API_KEY" ||
      integration.authType === "PERSONAL_ACCESS_TOKEN"
    ) {
      // For API key/PAT auth, the adapter is already authenticated via IntegrationManager
      // No need to set access token
    } else if (integration.userIntegrationAuths[0]) {
      // Set the user's access token if the adapter supports it
      const userAuth = integration.userIntegrationAuths[0];
      if (
        "setAccessToken" in adapter &&
        typeof adapter.setAccessToken === "function" &&
        userAuth.accessToken
      ) {
        adapter.setAccessToken(userAuth.accessToken);
      }
    }

    try {
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
      const integrationError = toIntegrationError(error, integration.provider);

      if (integrationError.kind === "auth") {
        // Only OAuth integrations can be repaired by the user re-authorizing;
        // expired API keys/PATs are fixed by an admin on the integration, so
        // those get the actionable message instead of a re-auth prompt that
        // cannot resolve them.
        if (
          integration.authType !== "API_KEY" &&
          integration.authType !== "PERSONAL_ACCESS_TOKEN"
        ) {
          return Response.json(
            {
              ...integrationErrorBody(integrationError),
              authUrl: buildOAuthKickoffUrl(
                integration.provider,
                integrationId
              ),
              requiresAuth: true,
            },
            { status: 401 }
          );
        }

        return Response.json(integrationErrorBody(integrationError), {
          status: responseStatusForIntegrationError(integrationError),
        });
      }

      throw integrationError;
    }
  } catch (error: any) {
    console.error("Search error:", error);

    // `toIntegrationError` is idempotent, so an error already typed by the
    // inner catch passes through unchanged. Responding with its `userMessage`
    // rather than `error.message` keeps adapter internals and upstream
    // response bodies out of the client.
    const integrationError = toIntegrationError(error, "");
    return Response.json(integrationErrorBody(integrationError), {
      status: responseStatusForIntegrationError(integrationError),
    });
  }
}
