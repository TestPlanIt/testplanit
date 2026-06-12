/**
 * SCIM 2.0 success response builders.
 *
 * Two shapes covered here:
 *   1. `scimResponse` — wraps a resource or static body with the SCIM media
 *      type. Used for single-resource GETs and discovery endpoints.
 *   2. `scimListResponse` — RFC 7644 §3.4.2 paginated list envelope used by
 *      every `/Users`, `/Groups`, and `/Schemas`-style listing endpoint.
 *
 * Plus the helpers for building `meta.location` URLs:
 *   - `getScimBaseUrl` reads `process.env.NEXTAUTH_URL` with a localhost
 *     fallback. Never reads request headers — a spoofed `Host` /
 *     `X-Forwarded-Host` would let an attacker poison the directory location
 *     advertised back to the IdP.
 *   - `scimLocation` composes the base URL with the resourceType and id.
 */

import { NextResponse } from "next/server";

import {
  SCIM_BASE_PATH,
  SCIM_CONTENT_TYPE,
  SCIM_LIST_RESPONSE_SCHEMA_URN,
} from "./constants";

/**
 * Base URL for SCIM resource locations.
 *
 * Reads only `process.env.NEXTAUTH_URL`; falls back to `http://localhost:3000`
 * when unset (matches the convention used by `lib/webhooks/event-emitters/
 * reviewEvents.ts:entityUrlFor`). Never derive the base URL from a request
 * `Host`, `X-Forwarded-Host`, or `Forwarded` header.
 */
export function getScimBaseUrl(): string {
  return process.env.NEXTAUTH_URL ?? "http://localhost:3000";
}

/**
 * Absolute URL for a SCIM resource. Used to populate `meta.location` on
 * resource responses and the three pointer URLs in the well-known probe.
 */
export function scimLocation(
  resourceType:
    | "Users"
    | "Groups"
    | "Schemas"
    | "ResourceTypes"
    | "ServiceProviderConfig",
  id?: string
): string {
  const base = getScimBaseUrl();
  return id
    ? `${base}${SCIM_BASE_PATH}/${resourceType}/${id}`
    : `${base}${SCIM_BASE_PATH}/${resourceType}`;
}

/**
 * RFC 7644 §3.4.2 ListResponse envelope wrapped in a SCIM-typed response.
 *
 * The single-page shape: `totalResults` and `itemsPerPage` both equal the
 * length of the provided resources array (Phase 5 callers always pass the
 * full result set — pagination ships with Phase 7's Users CRUD); `startIndex`
 * is fixed at `1` per RFC 7644 §3.4.2.4 (1-based indexing).
 */
export function scimListResponse<T>(resources: T[]): NextResponse {
  return NextResponse.json(
    {
      schemas: [SCIM_LIST_RESPONSE_SCHEMA_URN],
      totalResults: resources.length,
      itemsPerPage: resources.length,
      startIndex: 1,
      Resources: resources,
    },
    {
      status: 200,
      headers: { "Content-Type": SCIM_CONTENT_TYPE },
    }
  );
}

/**
 * Single-resource SCIM response with the correct content-type. Defaults to
 * status 200; pass `{ status: 201 }` for create flows.
 */
export function scimResponse(
  body: unknown,
  init?: { status?: number }
): NextResponse {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: { "Content-Type": SCIM_CONTENT_TYPE },
  });
}
