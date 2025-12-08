import { NextRequest, NextResponse } from "next/server";
import { getServerAuthSession } from "~/server/auth";
import { db } from "~/server/db";
import { createSAMLClient } from "~/server/saml-provider";
import { auditAuthEvent } from "~/lib/services/auditLog";

export async function POST(request: NextRequest) {
  try {
    // Get the current session to understand how the user signed in
    const session = await getServerAuthSession();
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No active session" }, { status: 401 });
    }

    // Get user information to determine auth method
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { 
        authMethod: true,
        accounts: {
          select: {
            provider: true,
            providerAccountId: true,
          }
        }
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const response = NextResponse.json({ 
      success: true,
      message: "Logout initiated successfully",
      shouldClearLocalData: true
    });

    // Clear NextAuth session cookies
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
      maxAge: 0, // Expire immediately
    };

    // Clear NextAuth session cookies
    response.cookies.set('next-auth.session-token', '', cookieOptions);
    response.cookies.set('__Secure-next-auth.session-token', '', {
      ...cookieOptions,
      secure: true,
    });

    // Clear SAML-related cookies if they exist
    response.cookies.set('saml-state', '', cookieOptions);
    response.cookies.set('saml-provider', '', cookieOptions);
    response.cookies.set('saml-callback-url', '', cookieOptions);

    // Clear Google OAuth cookies if they exist
    response.cookies.set('google-oauth-state', '', cookieOptions);
    response.cookies.set('google-oauth-verifier', '', cookieOptions);

    // Check if user has SSO accounts that need special logout handling
    const ssoAccounts = user.accounts.filter(account => 
      account.provider !== 'credentials'
    );

    const logoutUrls: string[] = [];

    // Handle SAML logout (SLO - Single Logout)
    const samlAccount = ssoAccounts.find(account => account.provider === 'saml');
    if (samlAccount) {
      try {
        // Find the SAML provider configuration
        const samlProvider = await db.ssoProvider.findFirst({
          where: { 
            type: 'SAML',
            enabled: true 
          },
          include: { samlConfig: true }
        });

        if (samlProvider?.samlConfig) {
          // Create SAML client for logout
          const samlClient = await createSAMLClient({
            name: samlProvider.name,
            entryPoint: samlProvider.samlConfig.entryPoint,
            cert: samlProvider.samlConfig.cert,
            issuer: samlProvider.samlConfig.issuer,
          });

          // Generate SAML logout request
          const logoutUrl = await samlClient.getLogoutUrlAsync(
            { 
              nameID: samlAccount.providerAccountId,
              nameIDFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
              issuer: samlProvider.samlConfig.issuer
            },
            'https://' + request.headers.get('host') + '/api/auth/saml/logout-callback',
            {}
          );

          if (logoutUrl) {
            logoutUrls.push(logoutUrl);
          }
        }
      } catch (error) {
        console.warn('Failed to generate SAML logout URL:', error);
      }
    }

    // Handle Google OAuth logout
    const googleAccount = ssoAccounts.find(account => account.provider === 'google');
    if (googleAccount) {
      // For Google OAuth, we can't force logout from Google accounts
      // We'll only clear our local session and let the client know
      // Google sessions remain active but won't auto-login to our app
      // Google OAuth account detected - clearing local session only
    }

    // Update user record to track logout
    await db.user.update({
      where: { id: session.user.id },
      data: {
        lastActiveAt: new Date(), // Track the logout as an activity
        // Note: We could add a lastLogoutAt field in the future if needed
      },
    });

    // Audit successful logout
    auditAuthEvent("LOGOUT", session.user.id, session.user.email || "", {
      authMethod: user.authMethod,
      hasSsoAccounts: ssoAccounts.length > 0,
    }).catch(console.error);

    // If we have SSO logout URLs, include them in the response
    if (logoutUrls.length > 0) {
      return NextResponse.json({
        success: true,
        message: "Logout initiated successfully",
        shouldClearLocalData: true,
        ssoLogoutUrls: logoutUrls,
        // Instructions for client-side handling
        instructions: {
          clearStorage: true,
          redirectToSignin: true,
          openSsoLogoutUrls: logoutUrls.length > 0
        }
      });
    }

    return response;

  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to process logout',
        shouldClearLocalData: true // Still try to clear local data even if SSO logout fails
      },
      { status: 500 }
    );
  }
}

// Handle SAML logout callback
export async function GET(request: NextRequest) {
  try {
    // Handle SAML logout response
    const searchParams = request.nextUrl.searchParams;
    const samlResponse = searchParams.get('SAMLResponse');
    
    if (samlResponse) {
      // Process SAML logout response
      // This would validate the logout response from the IdP
      // SAML logout response received
    }

    // Redirect to signin page after successful logout
    return NextResponse.redirect(new URL('/signin', request.url));
  } catch (error) {
    console.error('SAML logout callback error:', error);
    return NextResponse.redirect(new URL('/signin?error=logout-failed', request.url));
  }
}