/**
 * SCIM 2.0 success response builders.
 *
 * Two shapes covered here:
 *   1. Resource responses (`scimResource`) — wraps a single resource with the
 *      RFC 7643 §3.1 `meta` block and serializes with the SCIM media type.
 *   2. ListResponse envelopes (`scimList`) — RFC 7644 §3.4.2 paginated list
 *      shape used by every `/Users`, `/Groups`, and search endpoint.
 *
 * `meta.location` derivation rule (Phase 5 invariant): the base URL MUST come
 * from `process.env.NEXTAUTH_URL`. Never derive it from inbound request
 * headers (Host / X-Forwarded-Host) because identity providers cache the
 * advertised location and a spoofed Host header would let an attacker poison
 * the directory. If `NEXTAUTH_URL` is unset we emit a relative path — the IdP
 * will still be able to dereference it against the host it just called.
 */

import {
  SCIM_CONTENT_TYPE,
  SCIM_LIST_RESPONSE_SCHEMA,
} from "./constants";

/** RFC 7643 §3.1 — common resource metadata block. */
export interface ScimMeta {
  resourceType: string;
  created?: string;
  lastModified?: string;
  location: string;
  version?: string;
}

/** RFC 7644 §3.4.2 — ListResponse envelope. */
export interface ScimListResponse<T> {
  schemas: [typeof SCIM_LIST_RESPONSE_SCHEMA];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

/**
 * Build the `meta.location` URL for a resource.
 *
 * @param resourceType - e.g. "Users", "Groups", "ServiceProviderConfig"
 * @param id           - resource id; omit for singleton config resources
 *
 * Reads `process.env.NEXTAUTH_URL` exactly once per call. When unset, returns
 * a host-relative path (`/scim/v2/Users/abc`) which remains valid for the
 * caller that just hit the same origin.
 */
export function scimLocation(resourceType: string, id?: string): string {
  const base = process.env.NEXTAUTH_URL;
  const path = id
    ? `/scim/v2/${resourceType}/${id}`
    : `/scim/v2/${resourceType}`;

  if (!base) return path;

  // Strip any trailing slash on NEXTAUTH_URL so we never emit a double slash.
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${trimmed}${path}`;
}

/**
 * Wrap a resource body in a SCIM `Response` with the correct media type and
 * a status of 200 (default) or 201 for create flows.
 */
export function scimResource<T extends object>(
  body: T,
  init?: { status?: number },
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": SCIM_CONTENT_TYPE },
  });
}

/**
 * Build a RFC 7644 §3.4.2 ListResponse envelope.
 *
 * @param resources    - the page of resources to return (may be empty)
 * @param totalResults - total matching results across all pages
 * @param startIndex   - 1-based index of the first resource in `resources`
 *                       (RFC 7644 §3.4.2.4 — startIndex is 1-indexed)
 * @param itemsPerPage - number of resources actually returned in this page
 *                       (NOT the requested `count` parameter — see §3.4.2.4)
 */
export function scimList<T>(
  resources: T[],
  totalResults: number,
  startIndex: number,
  itemsPerPage: number,
): Response {
  const body: ScimListResponse<T> = {
    schemas: [SCIM_LIST_RESPONSE_SCHEMA],
    totalResults,
    startIndex,
    itemsPerPage,
    Resources: resources,
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": SCIM_CONTENT_TYPE },
  });
}
