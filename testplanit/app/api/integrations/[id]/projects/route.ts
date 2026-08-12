import { getEnhancedDb } from "@/lib/auth/utils";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { getIntegrationClient } from "~/lib/integrations";
import {
  integrationErrorBody,
  responseStatusForIntegrationError,
  toIntegrationError,
} from "~/lib/integrations/errors";
import { authOptions } from "~/server/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Captured for the catch block, which needs the provider to build a typed
  // error and the auth type to decide whether re-authorization is offerable.
  let provider = "";
  let authType = "";

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = await getEnhancedDb(session);
    const { id } = await params;
    const integrationId = parseInt(id);

    // Get the integration
    const integration = await db.integration.findFirst({
      where: {
        id: integrationId,
        status: "ACTIVE",
        isDeleted: false,
      },
    });

    if (!integration) {
      return NextResponse.json(
        { error: "Integration not found" },
        { status: 404 }
      );
    }

    provider = integration.provider;
    authType = integration.authType;

    // For API key integrations, we don't need user-specific auth
    let userAuth = null;
    if (integration.authType === "OAUTH2") {
      // Check if user has authentication for OAuth integrations
      userAuth = await db.userIntegrationAuth.findFirst({
        where: {
          userId: session.user.id,
          integrationId,
          isActive: true,
        },
      });

      if (!userAuth) {
        return NextResponse.json(
          { error: "Authentication required" },
          { status: 401 }
        );
      }
    }

    // Get integration client
    const client = await getIntegrationClient(integration, userAuth);

    // Fetch projects from the integration
    const projects = await client.getProjects();

    return NextResponse.json({ projects });
  } catch (error) {
    console.error("Error fetching integration projects:", error);

    const integrationError = toIntegrationError(error, provider);

    // An OAuth integration whose token was rejected is recoverable by
    // re-authorizing, and the settings UI branches on 401 to offer that. Every
    // other failure — including API-key credentials the provider rejected —
    // is not fixable by re-authorizing, so it returns the actionable message
    // instead of a re-auth prompt that would lead nowhere.
    if (integrationError.kind === "auth" && authType === "OAUTH2") {
      return NextResponse.json(
        { ...integrationErrorBody(integrationError), requiresAuth: true },
        { status: 401 }
      );
    }

    return NextResponse.json(integrationErrorBody(integrationError), {
      status: responseStatusForIntegrationError(integrationError),
    });
  }
}
