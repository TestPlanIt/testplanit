/**
 * Server-side Test SCIM probe.
 *
 * Decrypts the stored bearer secret for a single SCIM token and exercises
 * the real bearer-auth control flow against the lightest discovery endpoint
 * (`/api/scim/v2/ServiceProviderConfig`). The result -- `{ ok, status, reason? }`
 * -- is what the admin UI surfaces as an OK/FAIL banner. No response body
 * preview, no timing, no plaintext returned to the caller.
 *
 * The decrypted plaintext lives only in the stack-local `plaintext` const
 * for the lifetime of the outbound `fetch` call. It is never logged, never
 * persisted to a queue payload, and never returned to the server-action
 * caller -- only `{ ok, status, reason }` crosses the action boundary.
 *
 * Two carve-outs are honored on the outbound request:
 *
 *   - `X-SCIM-Probe: 1` is set so the bearer middleware (`lib/scim/auth.ts`)
 *     can suppress its throttled "last used" telemetry write -- the probe
 *     is admin-driven, not IdP-driven, and must not tick the human-visible
 *     usage timestamp on the token row.
 *
 *   - `cache: "no-store"` opts the call out of the Next.js data cache so a
 *     fresh fetch hits the discovery route every click.
 *
 * The probe is read-only at the ScimToken layer: it does not mutate the
 * row, does not revoke, does not tick any usage / sync telemetry column.
 * The audit-row write for "admin probed token X" is the server action's
 * responsibility, not this module's.
 */

import { SCIM_BASE_PATH } from "~/lib/scim/constants";
import { getScimBaseUrl } from "~/lib/scim/responses";
import { decryptScimSecret, getScimTokenWithSecret } from "~/lib/scim/tokens";

/**
 * Result of a single probe. `ok` mirrors `Response.ok` for HTTP results
 * and is `false` on every non-HTTP failure (token missing, token inactive,
 * fetch-level network error). `status` is `0` for non-HTTP failures so the
 * UI can distinguish "never reached the route" from a real 4xx/5xx. `reason`
 * is set only on failure; it carries an English diagnostic string.
 */
export interface ScimProbeResult {
  ok: boolean;
  status: number;
  reason?: string;
}

/**
 * Probe a SCIM bearer token by re-deriving the plaintext from the encrypted
 * secret column and issuing one authenticated GET against the local
 * `/api/scim/v2/ServiceProviderConfig` route. Returns a structured result
 * regardless of outcome; never throws.
 */
export async function probeScimToken(
  tokenId: string
): Promise<ScimProbeResult> {
  const row = await getScimTokenWithSecret(tokenId);
  if (!row) {
    return { ok: false, status: 0, reason: "Token not found" };
  }
  if (!row.isActive) {
    return { ok: false, status: 0, reason: "Token inactive" };
  }

  const plaintext = await decryptScimSecret(row.secret);
  const url = `${getScimBaseUrl()}${SCIM_BASE_PATH}/ServiceProviderConfig`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${plaintext}`,
        "X-SCIM-Probe": "1",
      },
      cache: "no-store",
    });
    return res.ok
      ? { ok: true, status: res.status }
      : { ok: false, status: res.status, reason: `HTTP ${res.status}` };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, reason };
  }
}
