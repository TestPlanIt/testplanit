import { getEnhancedDb } from "@/lib/auth/utils";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { AuthenticationService } from "~/lib/integrations/AuthenticationService";
import { IntegrationManager } from "~/lib/integrations/IntegrationManager";
import { authOptions } from "~/server/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  // Build post-OAuth redirects from the app's public URL, NOT request.url.
  // Behind the k8s ingress, request.url resolves to the internal pod hostname
  // (e.g. http://demo-prod-xxxx/...), so a Location built from it is
  // unreachable — the user lands on a connection error right after a
  // successful authorization. NEXTAUTH_URL is the public origin; fall back to
  // the request origin only if it's somehow unset.
  const baseUrl = process.env.NEXTAUTH_URL || new URL(request.url).origin;
  const redirectTo = (path: string) =>
    NextResponse.redirect(new URL(path, baseUrl));

  try {
    // Check if user is authenticated
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return redirectTo("/signin?error=unauthorized");
    }

    // Get OAuth parameters
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const error = request.nextUrl.searchParams.get("error");

    // Handle OAuth errors. Errors land on the auth-complete page: it is the
    // only destination every signed-in user can view — the settings pages the
    // flow used to target 404 for anyone below PROJECTADMIN.
    if (error) {
      const errorDescription =
        request.nextUrl.searchParams.get("error_description") ||
        "OAuth authorization failed";
      const { type } = await params;
      console.error(`OAuth error for ${type}:`, error, errorDescription);
      return redirectTo(
        `/integrations/auth-complete?error=${encodeURIComponent(errorDescription)}`
      );
    }

    if (!code || !state) {
      return redirectTo(
        "/integrations/auth-complete?error=missing_oauth_params"
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
    let returnUrl: string | undefined;

    // Check each integration for the matching state
    for (const integration of integrations) {
      const stateValidation = await AuthenticationService.verifyOAuthState(
        integration.id,
        state
      );
      if (stateValidation.valid && stateValidation.userId === session.user.id) {
        validIntegration = integration;
        integrationId = integration.id;
        returnUrl = stateValidation.returnUrl;
        break;
      }
    }

    if (!validIntegration) {
      return redirectTo("/integrations/auth-complete?error=invalid_state");
    }

    // Get the appropriate adapter
    const manager = IntegrationManager.getInstance();
    // The integration is still inactive at callback time (it's flipped to
    // ACTIVE below, once a token is stored), so allow building the adapter to
    // exchange the authorization code for tokens.
    const adapter = await manager.getAdapter(
      integrationId!.toString(),
      undefined,
      undefined,
      { allowInactive: true }
    );

    if (!adapter || !adapter.exchangeCodeForTokens) {
      return redirectTo(
        "/integrations/auth-complete?error=adapter_init_failed"
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

    // The adapter resolved above was cached before the user's token existed,
    // so it is unauthenticated. Evict it so subsequent requests rebuild the
    // adapter with the freshly stored token.
    manager.clearAdapter(integrationId!.toString());

    // Clean up the OAuth state
    await AuthenticationService.cleanupOAuthState(integrationId!, state);

    // Flip the integration to connected on its first successful
    // authorization. Integration updates are ADMIN-only under the access
    // policy, and any project member can (re)authorize an already-active
    // integration — a denial here must never discard the token exchange that
    // just succeeded, so the flip is skipped when already connected and
    // policy failures are non-fatal.
    const integrationSettings =
      (validIntegration.settings as Record<string, unknown>) || {};
    if (
      validIntegration.status !== "ACTIVE" ||
      !integrationSettings.connected
    ) {
      try {
        await db.integration.update({
          where: { id: integrationId! },
          data: {
            lastSyncAt: new Date(),
            status: "ACTIVE",
            settings: {
              ...integrationSettings,
              connected: true,
              connectedAt: new Date().toISOString(),
            },
          },
        });
      } catch (updateError) {
        console.error(
          `Failed to mark integration ${integrationId} connected (user lacks Integration update rights?):`,
          updateError
        );
      }
    }

    // Redirect to success page: the page the flow started from when it told
    // us (returnUrl stored with the OAuth state), else the admin integrations
    // page the legacy flows launch from.
    if (returnUrl) {
      const target = new URL(returnUrl, baseUrl);
      target.searchParams.set("success", "connected");
      return NextResponse.redirect(target);
    }
    return redirectTo("/admin/integrations?success=connected");
  } catch (error) {
    const { type } = await params;
    console.error(`Error in OAuth callback endpoint for ${type}:`, error);
    return redirectTo(
      "/integrations/auth-complete?error=oauth_callback_failed"
    );
  }
}
