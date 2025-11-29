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

export default async function middlewareWithPreferences(request: NextRequest) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Check trial expiration status
  const trialEndDate = process.env.TRIAL_END_DATE;
  const isTrialInstance = process.env.IS_TRIAL_INSTANCE === 'true';

  if (isTrialInstance && trialEndDate) {
    const expirationDate = new Date(trialEndDate);
    const now = new Date();

    // Extract the route path without locale
    const pathWithoutLocale = pathname.replace(/^\/[^/]+/, "");

    // Only check trial expiration for non-trial-expired routes
    if (!pathWithoutLocale.startsWith('/trial-expired') && now > expirationDate) {
      // Trial has expired - redirect to expiration page
      const pathSegments = pathname.split("/").filter(Boolean);
      const locale = pathSegments[0] || defaultLocale;
      const redirectUrl = new URL(request.url);
      redirectUrl.pathname = `/${locale}/trial-expired`;
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Define public routes that don't require authentication
  const publicRoutes = ["/signin", "/signup", "/verify-email", "/trial-expired"];

  // Extract the route path without locale (e.g., /en-US/signin -> /signin)
  const pathWithoutLocale = pathname.replace(/^\/[^/]+/, "");

  // Handle malformed double paths (e.g., /en-US/signin/signin)
  // This can happen if redirects are misconfigured somewhere
  if (pathWithoutLocale.match(/^\/(signin|signup|verify-email)\/(signin|signup|verify-email)/)) {
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
  const isPublicRoute = publicRoutes.some(route =>
    pathWithoutLocale === route || pathWithoutLocale.startsWith(`${route}/`)
  );

  // Check if this is the root route (home page)
  const isRootRoute = pathWithoutLocale === "" || pathWithoutLocale === "/";

  // Get the JWT token from the request for all protected routes
  let token = null;
  if (!isPublicRoute) {
    token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET
    });

    // For unauthenticated users trying to access protected routes
    if (!token) {
      // Redirect root route to signin for better UX
      if (isRootRoute) {
        const pathSegments = pathname.split("/").filter(Boolean);
        const locale = pathSegments[0] || defaultLocale;
        const redirectUrl = new URL(request.url);
        redirectUrl.pathname = `/${locale}/signin`;
        redirectUrl.search = ""; // Clear any query params
        redirectUrl.hash = ""; // Clear any hash
        return NextResponse.redirect(redirectUrl);
      }
      // Return 404 for other protected routes
      return new NextResponse(null, { status: 404 });
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
  // Match only internationalized pathnames
  matcher: ["/((?!api|_next|.*\\..*|_vercel|favicon.ico).*)"],
};
