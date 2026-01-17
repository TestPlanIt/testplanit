import createMiddleware from "next-intl/middleware";
import { locales, defaultLocale } from "./i18n/navigation";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";

const middleware = createMiddleware({
  // A list of all locales that are supported
  locales,

  // Used when no locale matches
  defaultLocale,

  localePrefix: "always",
});

/**
 * Check if the request has an API token (Bearer token with tpi_ prefix)
 * These requests will be authenticated by the API routes themselves
 */
function hasApiToken(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  return authHeader?.startsWith("Bearer tpi_") ?? false;
}

/**
 * Determines if a request is coming from an external API client (not a browser on the same origin).
 *
 * This checks for browser-specific headers that indicate the request originated from a
 * same-origin browser context. External API clients (curl, Postman, scripts, etc.) won't
 * have these headers.
 */
function isExternalApiRequest(request: NextRequest): boolean {
  // Check Sec-Fetch-Site header - browsers set this for all requests
  // "same-origin" means the request came from the same origin (browser app)
  // External API clients don't set this header
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "same-origin" || secFetchSite === "same-site") {
    return false;
  }

  // Check Origin header - if it matches our host, it's same-origin
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host === host) {
        return false;
      }
    } catch {
      // Invalid URL, treat as external
    }
  }

  // Check Referer header - if it matches our host, likely same-origin browser request
  const referer = request.headers.get("referer");
  if (referer && host) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.host === host) {
        return false;
      }
    } catch {
      // Invalid URL, treat as external
    }
  }

  // No browser-specific headers found - treat as external API request
  return true;
}

export default async function middlewareWithPreferences(request: NextRequest) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Check if this is an API route (excluding auth routes which need to remain accessible)
  const isApiRoute = pathname.startsWith("/api/");
  const isAuthRoute = pathname.startsWith("/api/auth/");

  // Auth routes should pass through without any middleware processing
  if (isAuthRoute) {
    return NextResponse.next();
  }

  if (isApiRoute) {
    // If request has an API token (Bearer tpi_*), let the API route handle authentication
    // API routes will use authenticateApiToken() to validate the token
    if (hasApiToken(request)) {
      return NextResponse.next();
    }

    // Get the JWT token for API routes (session-based auth)
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });

    // If no token, let the API route handler deal with it (return 401)
    if (!token) {
      return NextResponse.next();
    }

    // ADMINs always have API access
    if (token.access === "ADMIN") {
      return NextResponse.next();
    }

    // Check if this is an external API request
    if (isExternalApiRequest(request)) {
      // For external API requests, user must have isApi enabled
      if (!token.isApi) {
        return NextResponse.json(
          { error: "External API access not enabled for this account" },
          { status: 403 }
        );
      }
    }

    // Allow the request
    return NextResponse.next();
  }

  // Check trial expiration status
  const trialEndDate = process.env.TRIAL_END_DATE;
  const isTrialInstance = process.env.IS_TRIAL_INSTANCE === "true";

  if (isTrialInstance && trialEndDate) {
    const expirationDate = new Date(trialEndDate);
    const now = new Date();

    // Extract the route path without locale
    const pathWithoutLocale = pathname.replace(/^\/[^/]+/, "");

    // Only check trial expiration for non-trial-expired routes
    if (
      !pathWithoutLocale.startsWith("/trial-expired") &&
      now > expirationDate
    ) {
      // Trial has expired - redirect to expiration page
      const pathSegments = pathname.split("/").filter(Boolean);
      const locale = pathSegments[0] || defaultLocale;
      const redirectUrl = new URL(request.url);
      redirectUrl.pathname = `/${locale}/trial-expired`;
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Define public routes that don't require authentication
  const publicRoutes = [
    "/signin",
    "/signup",
    "/verify-email",
    "/trial-expired",
    "/auth/two-factor-setup",
    "/auth/two-factor-verify",
    "/share",
  ];

  // Extract the route path without locale (e.g., /en-US/signin -> /signin)
  const pathWithoutLocale = pathname.replace(/^\/[^/]+/, "");

  // Handle malformed double paths (e.g., /en-US/signin/signin)
  // This can happen if redirects are misconfigured somewhere
  if (
    pathWithoutLocale.match(
      /^\/(signin|signup|verify-email)\/(signin|signup|verify-email)/
    )
  ) {
    const pathSegments = pathname.split("/").filter(Boolean);
    const locale = pathSegments[0] || defaultLocale;
    const correctRoute = pathSegments[1]; // Get the first route segment
    const redirectUrl = new URL(request.url);
    redirectUrl.pathname = `/${locale}/${correctRoute}`;
    redirectUrl.search = ""; // Clear any query params
    redirectUrl.hash = ""; // Clear any hash
    return NextResponse.redirect(redirectUrl);
  }

  // Check if this is a public route
  const isPublicRoute = publicRoutes.some(
    (route) =>
      pathWithoutLocale === route || pathWithoutLocale.startsWith(`${route}/`)
  );

  // Get the JWT token from the request for all protected routes
  let token = null;
  if (!isPublicRoute) {
    token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });

    // For unauthenticated users trying to access protected routes
    if (!token) {
      // Redirect to signin page
      const pathSegments = pathname.split("/").filter(Boolean);
      const locale = pathSegments[0] || defaultLocale;
      const redirectUrl = new URL(request.url);
      redirectUrl.pathname = `/${locale}/signin`;
      redirectUrl.search = ""; // Clear any query params
      redirectUrl.hash = ""; // Clear any hash
      return NextResponse.redirect(redirectUrl);
    }

    // Check if 2FA verification is required for SSO users
    if (token.twoFactorRequired && !token.twoFactorVerified) {
      const pathSegments = pathname.split("/").filter(Boolean);
      const locale = pathSegments[0] || defaultLocale;
      const redirectUrl = new URL(request.url);
      redirectUrl.pathname = `/${locale}/auth/two-factor-verify`;
      return NextResponse.redirect(redirectUrl);
    }

    // Check if 2FA setup is required for SSO users who haven't set it up
    if (token.twoFactorSetupRequired) {
      const pathSegments = pathname.split("/").filter(Boolean);
      const locale = pathSegments[0] || defaultLocale;
      const redirectUrl = new URL(request.url);
      redirectUrl.pathname = `/${locale}/auth/two-factor-setup`;
      redirectUrl.searchParams.set("sso", "true");
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Check if this is an admin route
  // Admin routes follow the pattern: /[locale]/admin/*
  const adminRouteMatch = pathname.match(/^\/[^/]+\/admin(\/|$)/);

  if (adminRouteMatch) {
    // Check if user has ADMIN access
    // The access level is stored in the JWT token
    if (token?.access !== "ADMIN") {
      // Redirect non-admin users to home page
      const pathSegments = pathname.split("/").filter(Boolean);
      const locale = pathSegments[0] || defaultLocale;
      const redirectUrl = new URL(request.url);
      redirectUrl.pathname = `/${locale}/`;
      redirectUrl.search = ""; // Clear any query params
      redirectUrl.hash = ""; // Clear any hash
      return NextResponse.redirect(redirectUrl);
    }
  }
  // Check for locale preference in cookie
  const cookieLocale = request.cookies.get("NEXT_LOCALE")?.value;

  if (cookieLocale && locales.includes(cookieLocale as any)) {
    const currentLocale = pathname.split("/")[1];

    // If URL doesn't start with preferred locale, redirect
    if (!currentLocale || currentLocale !== cookieLocale) {
      // Check if current path already starts with a locale
      const startsWithLocale = locales.includes(currentLocale as any);

      const localeRedirectUrl = new URL(request.url);
      if (startsWithLocale) {
        // Replace existing locale
        localeRedirectUrl.pathname = `/${cookieLocale}${pathname.replace(/^\/[^/]*/, "")}`;
      } else {
        // Add locale prefix to path that doesn't have one
        localeRedirectUrl.pathname = `/${cookieLocale}${pathname}`;
      }
      return NextResponse.redirect(localeRedirectUrl);
    }
  }

  return middleware(request);
}

export const config = {
  // Match internationalized pathnames and API routes (for external API access control)
  matcher: [
    // Match all API routes (for external API access control)
    "/api/:path*",
    // Match all internationalized pathnames (excluding static files)
    "/((?!_next|.*\\..*|_vercel|favicon.ico).*)",
  ],
};
