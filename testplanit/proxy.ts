import { getToken } from "next-auth/jwt";
import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { checkApiRateLimit, type RateLimitResult } from "~/lib/api-rate-limit";
import { isLinkPreviewBot, matchPreviewRoute } from "~/lib/linkPreview";
import { normalizeRecordKeyPath } from "~/lib/recordKeyRoutes";
import { getCachedSessionUser } from "~/lib/session-cache";
import { defaultLocale, locales } from "./i18n/navigation";

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

/**
 * Matches the OAuth "connect an integration" routes (e.g.
 * /api/integrations/oauth/jira/auth and /api/integrations/oauth/jira/callback).
 *
 * The callback leg is hit via a genuine cross-site browser redirect: the
 * provider (auth.atlassian.com, github.com, etc.) navigates the user's
 * browser back to us with Origin/Referer set to the provider's own domain,
 * not ours. That trips isExternalApiRequest() even though this is an
 * ordinary session-cookie-authenticated browser flow, not a programmatic
 * API call — the route itself still enforces auth via getServerSession.
 * Both legs are exempted for symmetry.
 */
function isOAuthIntegrationRoute(pathname: string): boolean {
  return /^\/api\/integrations\/oauth\/[^/]+\/(auth|callback)$/.test(pathname);
}

export default async function middlewareWithPreferences(request: NextRequest) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Cosmetic project-prefixed record keys: if a detail-route URL carries a
  // prefixed key (e.g. /projects/repository/5/PROJECT-TC-1234),
  // redirect to the canonical numeric URL (/projects/repository/5/1234) before
  // anything else runs. The number is embedded in the key, so this is a pure
  // string transform — no DB lookup. Browser routes only (never /api/*).
  if (!pathname.startsWith("/api/")) {
    const firstSegment = pathname.split("/")[1] ?? "";
    const hasLocale = (locales as readonly string[]).includes(firstSegment);
    const localePrefix = hasLocale ? `/${firstSegment}` : "";
    const pathAfterLocale = pathname.slice(localePrefix.length);
    const normalized = normalizeRecordKeyPath(pathAfterLocale);
    if (normalized) {
      const redirectUrl = new URL(request.url);
      redirectUrl.pathname = `${localePrefix}${normalized}`;
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Handle /share and /passwordless routes - redirect to localized version
  // These are entered from emailed (locale-less) URLs, so we redirect to the
  // localized version based on user preference or browser Accept-Language
  // header. Without this, the auth guard below would misparse the first path
  // segment as a locale.
  if (pathname.startsWith("/share/") || pathname.startsWith("/passwordless/")) {
    // Get user's session to check their preferred locale
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });

    let targetLocale: string = defaultLocale;

    if (token?.locale && typeof token.locale === "string") {
      // Use authenticated user's preferred locale
      targetLocale = token.locale;
    } else {
      // For anonymous users, detect from Accept-Language header
      const acceptLanguage = request.headers.get("accept-language");
      if (acceptLanguage) {
        // Parse the Accept-Language header (e.g., "en-US,en;q=0.9,es;q=0.8")
        const preferredLang = acceptLanguage
          .split(",")[0]
          ?.split(";")[0]
          ?.trim();
        // Check if the preferred language is in our supported locales
        if (preferredLang && locales.includes(preferredLang as any)) {
          targetLocale = preferredLang;
        } else if (preferredLang) {
          // Try to match just the language code (e.g., "en" from "en-GB")
          const langCode = preferredLang.split("-")[0];
          const matchingLocale = locales.find((loc) =>
            loc.startsWith(langCode)
          );
          if (matchingLocale) {
            targetLocale = matchingLocale;
          }
        }
      }
    }

    // Redirect to localized share URL
    const redirectUrl = new URL(request.url);
    redirectUrl.pathname = `/${targetLocale}${pathname}`;
    return NextResponse.redirect(redirectUrl);
  }

  // Check if this is an API route (excluding auth routes which need to remain accessible)
  const isApiRoute = pathname.startsWith("/api/");
  const isAuthRoute = pathname.startsWith("/api/auth/");

  // Auth, health, and share routes should pass through without any middleware processing
  const isShareRoute = pathname.startsWith("/api/share/");
  if (isAuthRoute || isShareRoute || pathname === "/api/health") {
    return NextResponse.next();
  }

  if (isApiRoute) {
    // Rate limit only applies to API token requests (Bearer tpi_*)
    const isProgrammatic = hasApiToken(request);

    // Check rate limit for programmatic API requests
    let rateLimit: RateLimitResult | null = null;
    if (isProgrammatic) {
      rateLimit = await checkApiRateLimit();

      if (!rateLimit.allowed) {
        const retryAfter = Math.max(
          0,
          rateLimit.resetAt - Math.floor(Date.now() / 1000)
        );
        return new NextResponse(
          JSON.stringify({
            error: "Rate limit exceeded",
            message: `API rate limit of ${rateLimit.limit} requests per hour exceeded. Try again in ${retryAfter} seconds.`,
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "X-RateLimit-Limit": String(rateLimit.limit),
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": String(rateLimit.resetAt),
              "Retry-After": String(retryAfter),
            },
          }
        );
      }
    }

    // Helper to attach rate limit headers to a response
    const withRateLimitHeaders = (response: NextResponse): NextResponse => {
      if (rateLimit) {
        response.headers.set("X-RateLimit-Limit", String(rateLimit.limit));
        response.headers.set(
          "X-RateLimit-Remaining",
          String(rateLimit.remaining)
        );
        response.headers.set("X-RateLimit-Reset", String(rateLimit.resetAt));
      }
      return response;
    };

    // If request has an API token (Bearer tpi_*), let the API route handle authentication
    // API routes will use authenticateApiToken() to validate the token
    if (hasApiToken(request)) {
      return withRateLimitHeaders(NextResponse.next());
    }

    // Get the JWT token for API routes (session-based auth)
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });

    // If no token, let the API route handler deal with it (return 401)
    if (!token) {
      return withRateLimitHeaders(NextResponse.next());
    }

    // ADMINs always have API access
    if (token.access === "ADMIN") {
      return withRateLimitHeaders(NextResponse.next());
    }

    // Check if this is an external API request
    // Share API routes are exempt. (Internal shared-report fetches no longer
    // need an exemption here: they carry no cookies, so they fall through the
    // no-token branch above and are authorized by the report routes via the
    // internal bypass token.)
    const isShareBypass = pathname.startsWith("/api/share/");
    const isOAuthBypass = isOAuthIntegrationRoute(pathname);
    if (!isShareBypass && !isOAuthBypass && isExternalApiRequest(request)) {
      // For external API requests, user must have isApi enabled
      let hasApiAccess = token.isApi === true;

      // token.isApi is baked into the JWT at login/refresh time and can lag
      // a DB grant for the life of the session (its JWT is only refreshed on
      // sign-in or an explicit client-side update — enabling the admin
      // toggle doesn't touch a user's existing session). Before blocking,
      // re-check against the same short-TTL cache the session callback uses
      // (see lib/session-cache.ts), so a grant takes effect within seconds
      // instead of requiring the user to log out and back in.
      if (!hasApiAccess && token.sub) {
        const cached = await getCachedSessionUser(token.sub);
        hasApiAccess = cached?.isApi === true;
      }

      if (!hasApiAccess) {
        return NextResponse.json(
          { error: "External API access not enabled for this account" },
          { status: 403 }
        );
      }
    }

    // Allow the request
    return withRateLimitHeaders(NextResponse.next());
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
    "/passwordless",
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
    // Preserve error parameter from NextAuth (e.g., expired magic link)
    const errorParam = url.searchParams.get("error");
    if (errorParam) {
      redirectUrl.searchParams.set("error", errorParam);
    }
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
      const pathSegments = pathname.split("/").filter(Boolean);
      const locale = pathSegments[0] || defaultLocale;

      // Link unfurlers (Slack, Teams, iMessage, …) fetch the URL with no
      // cookies. Redirecting them to /signin makes every shared deep link
      // preview as the sign-in page's metadata — one generic card for the whole
      // app. Rewrite to a metadata-only document instead so the card reflects
      // what was actually shared. The rewrite keeps the URL and status, renders
      // none of the app shell, and reads no record data unless the instance
      // opted in via LINK_PREVIEW_MODE.
      if (isLinkPreviewBot(request.headers.get("user-agent"))) {
        const { entity, id } = matchPreviewRoute(pathWithoutLocale);

        // The handler still sees the *incoming* URL after a rewrite, so the
        // destination's query string never reaches it — pass what it needs as
        // request headers, which Next does propagate to rewrite destinations.
        const previewHeaders = new Headers(request.headers);
        previewHeaders.set("x-link-preview-entity", entity);
        previewHeaders.set("x-link-preview-locale", locale);
        previewHeaders.set("x-link-preview-path", pathname);
        if (id !== null) previewHeaders.set("x-link-preview-id", String(id));

        return NextResponse.rewrite(new URL("/api/link-preview", request.url), {
          request: { headers: previewHeaders },
        });
      }

      // Redirect to signin page
      const redirectUrl = new URL(request.url);
      redirectUrl.pathname = `/${locale}/signin`;
      // Preserve error parameter from NextAuth (e.g., expired magic link)
      const errorParam = url.searchParams.get("error");
      if (errorParam) {
        redirectUrl.searchParams.set("error", errorParam);
      }
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

    // Check if password change is required (per D-04 — mirrors 2FA pattern)
    if (token.mustChangePassword) {
      // Don't redirect if already on the force-change page or its API
      const isForceChangePath =
        pathWithoutLocale === "/auth/force-change-password" ||
        pathWithoutLocale.startsWith("/auth/force-change-password/");
      const isForceChangeApi =
        pathname.includes("/api/users/") &&
        pathname.includes("/force-change-password");
      // Allow the password-policy API (used by the force-change page to display requirements)
      const isPasswordPolicyApi =
        pathname.includes("/api/users/") &&
        pathname.includes("/password-policy");
      // Allow signout and all auth API routes
      const isSignOutApi = pathname.includes("/api/auth/");

      if (
        !isForceChangePath &&
        !isForceChangeApi &&
        !isPasswordPolicyApi &&
        !isSignOutApi
      ) {
        const pathSegments = pathname.split("/").filter(Boolean);
        const locale = pathSegments[0] || defaultLocale;
        const redirectUrl = new URL(request.url);
        redirectUrl.pathname = `/${locale}/auth/force-change-password`;
        return NextResponse.redirect(redirectUrl);
      }
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
    // Match all internationalized pathnames (excluding static files and the
    // SCIM 2.0 surface — `/scim/v2/*` is gated by its own bearer middleware
    // at the route layer, not by the NextAuth session check this proxy
    // enforces; otherwise the locale strip below treats "scim" as a locale
    // and the request gets redirected to /signin).
    "/((?!_next|.*\\..*|_vercel|favicon.ico|scim).*)",
  ],
};
