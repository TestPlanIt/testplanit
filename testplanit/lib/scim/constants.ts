/**
 * SCIM 2.0 URN registry and content-type constant per RFC 7643 and RFC 7644.
 *
 * Every SCIM route handler, response builder, and test imports its schema URN
 * strings from this file so a one-line change here propagates everywhere.
 */

/** RFC 7644 §3.1 — the only Content-Type SCIM servers MUST accept and emit. */
export const SCIM_CONTENT_TYPE = "application/scim+json" as const;

/**
 * RFC 7643 §4 + §3.3 — core resource and enterprise-extension schema URNs.
 * Keys map to the symbolic names callers use (CORE_USER, etc.); values are the
 * exact URN strings IdPs send and receive on the wire.
 */
export const SCIM_SCHEMAS = {
  CORE_USER: "urn:ietf:params:scim:schemas:core:2.0:User",
  CORE_GROUP: "urn:ietf:params:scim:schemas:core:2.0:Group",
  ENTERPRISE_USER: "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
  SERVICE_PROVIDER_CONFIG:
    "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig",
  RESOURCE_TYPE: "urn:ietf:params:scim:schemas:core:2.0:ResourceType",
  SCHEMA: "urn:ietf:params:scim:schemas:core:2.0:Schema",
} as const;

export type ScimSchema = (typeof SCIM_SCHEMAS)[keyof typeof SCIM_SCHEMAS];

/** RFC 7644 §3.4.2 — schema URN for ListResponse envelopes. */
export const SCIM_LIST_RESPONSE_SCHEMA_URN =
  "urn:ietf:params:scim:api:messages:2.0:ListResponse" as const;

/** RFC 7644 §3.12 — schema URN used to identify SCIM error responses. */
export const SCIM_ERROR_SCHEMA_URN =
  "urn:ietf:params:scim:api:messages:2.0:Error" as const;

/** RFC 7644 §3.5.2 — schema URN for PATCH request bodies. */
export const SCIM_PATCH_OP_SCHEMA_URN =
  "urn:ietf:params:scim:api:messages:2.0:PatchOp" as const;

/**
 * Wire-stable prefix for every SCIM bearer token. The proxy / bearer helper
 * branches on this prefix BEFORE any DB lookup to keep the SCIM auth surface
 * cleanly separated from `tpi_`-prefixed API tokens.
 */
export const SCIM_TOKEN_PREFIX = "tps_" as const;

/**
 * Sentinel email for the seeded synthetic SCIM-provisioner User row. The
 * admin Users page renders a "SCIM Provisioner" badge when it sees this
 * exact value; treat it as a stable contract rather than a magic string.
 */
export const SCIM_SYSTEM_USER_EMAIL = "scim@__system__" as const;

/**
 * Deterministic id of the seeded synthetic SCIM-provisioner User row.
 * The mint helper FKs against this literal so it never needs a SELECT
 * roundtrip, and the seed upsert keys on this id to stay idempotent.
 */
export const SCIM_SYSTEM_USER_ID = "system-scim-user" as const;

/**
 * Throttle window (ms) for ScimToken.lastUsedAt / lastUsedIp writes.
 * The bearer middleware persists only when the in-DB lastUsedAt is older
 * than this window, capping write amplification under bulk-sync traffic.
 */
export const SCIM_LAST_USED_THROTTLE_MS = 60_000 as const;

/**
 * Throttle window (ms) for ScimToken.lastSyncAt writes. Each successful
 * SCIM mutation (POST/PUT/PATCH/DELETE on /Users or /Groups) bumps the
 * token's lastSyncAt, but only when the in-DB value is older than this
 * window — caps write amplification under bulk-sync traffic the same way
 * lastUsedAt does.
 */
export const SCIM_LAST_SYNC_THROTTLE_MS = 60_000 as const;

/**
 * Deterministic id of the sentinel `__system__` Projects row that every
 * tenant-wide SCIM webhook event FKs against (WebhookOutboxEvent.projectId
 * is NOT NULL). Projects.id is `Int @id @default(autoincrement())`, which
 * starts at 1 and increments positively, so a fixed negative literal is
 * safe from autoincrement collision.
 */
export const SYSTEM_PROJECT_ID = -1 as const;

/**
 * Per-token request-per-second cap enforced by the SCIM bearer middleware.
 * The bucket lives in Valkey via the shared sliding-window rate-limit helper
 * so concurrent app instances share the same counter. Sized for the common
 * Okta/Entra bulk-sync shape (sustained ~10 RPS, occasional bursts to ~30);
 * 50 leaves headroom without inviting accidental DoS from a misconfigured
 * connector.
 */
export const SCIM_RPS_LIMIT = 50 as const;

/**
 * Coalescing trigger: when a single webhook config's per-resource SCIM event
 * rate inside the active window crosses this threshold, the emitter folds
 * subsequent events into one summary event keyed by
 * (webhookConfigId, payloadDigest) per WebhookEventDedup. Picked to keep
 * normal incremental sync traffic 1:1 while collapsing first-sync floods.
 */
export const SCIM_COALESCING_THRESHOLD = 10 as const;

/**
 * Rolling window length (ms) used to evaluate the coalescing threshold. Five
 * minutes covers the typical Okta first-sync shape (initial assignment push
 * for a 500-user org completes in roughly 3-4 minutes), so a burst that
 * exceeds the threshold is folded into a single summary event for the entire
 * sync rather than the first chunk only.
 */
export const SCIM_COALESCING_WINDOW_MS = 300_000 as const;
