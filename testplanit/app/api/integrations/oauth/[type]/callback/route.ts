import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { AuthenticationService } from "~/lib/integrations/AuthenticationService";
import { IntegrationManager } from "~/lib/integrations/IntegrationManager";
import { getEnhancedDb } from "@/lib/auth/utils";
import { prisma } from "~/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  try {
    // Check if user is authenticated
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.redirect("/signin?error=unauthorized");
    }

    // Get OAuth parameters
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const error = request.nextUrl.searchParams.get("error");

    // Handle OAuth errors
    if (error) {
      const errorDescription =
        request.nextUrl.searchParams.get("error_description") ||
        "OAuth authorization failed";
      const { type } = await params;
      console.error(`OAuth error for ${type}:`, error, errorDescription);
      return NextResponse.redirect(
        `/projects/settings?error=${encodeURIComponent(errorDescription)}`
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        "/projects/settings?error=missing_oauth_params"
      );
    }

    // Get enhanced Prisma client for the user
    const db = await getEnhancedDb(session);

    // Get all integrations of this type to find the one matching the state
    const { type } = await params;
    const providerType = type.toUpperCase();
    const integrations = await db.integration.findMany({
      where: { provider: providerType as any },
    });

    let validIntegration = null;
    let integrationId = null;

    // Check each integration for the matching state
    for (const integration of integrations) {
      const stateValidation = await AuthenticationService.verifyOAuthState(
        integration.id,
        state
      );
      if (stateValidation.valid && stateValidation.userId === session.user.id) {
        validIntegration = integration;
        integrationId = integration.id;
        break;
      }
    }

    if (!validIntegration) {
      return NextResponse.redirect("/projects/settings?error=invalid_state");
    }

    // Get the appropriate adapter
    const manager = IntegrationManager.getInstance();
    const adapter = await manager.getAdapter(integrationId!.toString());

    if (!adapter || !adapter.exchangeCodeForTokens) {
      return NextResponse.redirect(
        "/projects/settings?error=adapter_init_failed"
      );
    }

    // Exchange code for tokens
    const tokens = await adapter.exchangeCodeForTokens(code);

    // Store encrypted tokens
    await AuthenticationService.storeUserAuth(session.user.id, integrationId!, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });

    // Clean up the OAuth state
    await AuthenticationService.cleanupOAuthState(integrationId!, state);

    // Update integration status to indicate it's connected
    await db.integration.update({
      where: { id: integrationId! },
      data: {
        lastSyncAt: new Date(),
        status: "ACTIVE",
        settings: {
          ...((validIntegration.settings as object) || {}),
          connected: true,
          connectedAt: new Date().toISOString(),
        },
      },
    });

    // Redirect to success page
    const projectId = (validIntegration as any).issueConfigs?.[0]?.projects?.[0]
      ?.id;
    if (projectId) {
      return NextResponse.redirect(
        `/projects/settings/${projectId}/integrations?success=connected`
      );
    } else {
      return NextResponse.redirect("/admin/integrations?success=connected");
    }
  } catch (error) {
    const { type } = await params;
    console.error(
      `Error in OAuth callback endpoint for ${type}:`,
      error
    );
    return NextResponse.redirect(
      "/projects/settings?error=oauth_callback_failed"
    );
  }
}
