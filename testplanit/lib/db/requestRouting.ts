// lib/db/requestRouting.ts
//
// Read/write routing for a route handler: wraps it in a routing frame built
// from the request, so its reads can reach a read replica when
// DATABASE_REPLICA_URLS is configured. Without replicas every wrapper here
// calls the handler directly.
//
// What a request gets:
//   - GET / HEAD from a browser: plain SELECTs go to a replica until the
//     handler writes, after which it reads its own writes from the primary.
//   - Any other method: everything on the primary.
//   - A request carrying the stickiness cookie: everything on the primary.
//   - A request with a Bearer token: everything on the primary. An API client
//     keeps no cookie jar, so the cookie cannot give it read-your-own-writes
//     across requests, and scripts routinely create a record and read it back.
//
// A handler that wrote sets the stickiness cookie on its response, whatever
// its method, so the browser's next requests read from the primary too.

import {
  getPrimaryStickyMs,
  isReplicaRoutingEnabled,
  PRIMARY_STICKY_COOKIE,
  primaryStickyCookie,
} from "./replicaConfig";
import { getRoutingContext, runWithDbRouting } from "./routingContext";

export interface RequestRoutingInit {
  autoReplica: boolean;
  forcePrimary: boolean;
  label: string;
}

function hasStickyCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  return cookieHeader
    .split(";")
    .some((part) => part.trim().startsWith(`${PRIMARY_STICKY_COOKIE}=`));
}

function pathnameOf(url: string): string {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url;
  }
}

/** The routing frame a request should run in. */
export function requestRoutingInit(req: Request): RequestRoutingInit {
  const method = req.method.toUpperCase();
  const isRead = method === "GET" || method === "HEAD";
  const hasBearerToken = /^bearer\s/i.test(
    req.headers.get("authorization") ?? ""
  );
  const honorsCookie =
    getPrimaryStickyMs() > 0 && hasStickyCookie(req.headers.get("cookie"));
  return {
    autoReplica: isRead && !hasBearerToken,
    forcePrimary: honorsCookie,
    label: `${method} ${pathnameOf(req.url)}`,
  };
}

function pinNextReadsToPrimary(response: unknown): void {
  const cookie = primaryStickyCookie();
  if (!cookie || !(response instanceof Response)) return;
  try {
    response.headers.append("Set-Cookie", cookie);
  } catch {
    // A redirect built by Response.redirect() has immutable headers. The
    // browser then relies on the write having replicated by its next read.
  }
}

type RouteHandler = (...args: any[]) => unknown;

function wrap<H extends RouteHandler>(handler: H, primaryOnly: boolean): H {
  const wrapped = (...args: unknown[]) => {
    const req = args[0];
    if (!isReplicaRoutingEnabled() || !(req instanceof Request)) {
      return handler(...args);
    }
    const init = requestRoutingInit(req);
    return runWithDbRouting(
      async () => {
        const response = await handler(...args);
        if (getRoutingContext()?.wroteInContext) {
          pinNextReadsToPrimary(response);
        }
        return response;
      },
      primaryOnly ? { ...init, autoReplica: false, forcePrimary: true } : init
    );
  };
  return wrapped as H;
}

/**
 * Run a route handler inside the routing frame its request calls for. Wrap
 * every exported method of a route: reads offload, and a write pins the
 * browser's following reads to the primary.
 */
export function withRequestRouting<H extends RouteHandler>(handler: H): H {
  return wrap(handler, false);
}

/**
 * The same frame with every read pinned to the primary. For a GET handler
 * that writes something it decided from what it read: a replica that has not
 * caught up must not feed that decision.
 */
export function withPrimaryRequestRouting<H extends RouteHandler>(
  handler: H
): H {
  return wrap(handler, true);
}
