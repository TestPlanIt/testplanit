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
        // Generate auth URL for this integration
        const manager = IntegrationManager.getInstance();
        const adapter = await manager.getAdapter(integrationId.toString());

        if (!adapter || !adapter.getAuthorizationUrl) {
          return Response.json({ error: "Adapter not found" }, { status: 404 });
        }

        const authUrl = await adapter.getAuthorizationUrl(session.user.id);

        return Response.json(
          {
            error: "Authentication required",
            authUrl,
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

      // Only an OAuth integration can recover by re-authorizing. Offering that
      // for an API-key integration would send the admin through a flow that
      // cannot fix rejected API-key credentials.
      if (
        integrationError.kind === "auth" &&
        integration.authType === "OAUTH2"
      ) {
        const authUrl =
          typeof adapter.getAuthorizationUrl === "function"
            ? await adapter.getAuthorizationUrl(session.user.id)
            : undefined;

        return Response.json(
          {
            ...integrationErrorBody(integrationError),
            ...(authUrl ? { authUrl } : {}),
            requiresAuth: true,
          },
          { status: 401 }
        );
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
