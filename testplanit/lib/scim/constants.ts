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
  ENTERPRISE_USER:
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
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
