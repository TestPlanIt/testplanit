import { describe, it, expect } from "vitest";

import {
  SCIM_CONTENT_TYPE,
  SCIM_ERROR_SCHEMA_URN,
  SCIM_LAST_USED_THROTTLE_MS,
  SCIM_LIST_RESPONSE_SCHEMA_URN,
  SCIM_PATCH_OP_SCHEMA_URN,
  SCIM_SCHEMAS,
  SCIM_SYSTEM_USER_EMAIL,
  SCIM_SYSTEM_USER_ID,
  SCIM_TOKEN_PREFIX,
  type ScimSchema,
} from "./constants";

describe("SCIM constants", () => {
  it("uses the RFC 7644 §3.1 SCIM media type", () => {
    expect(SCIM_CONTENT_TYPE).toBe("application/scim+json");
  });

  it("uses the RFC 7644 §3.12 Error message schema URN", () => {
    expect(SCIM_ERROR_SCHEMA_URN).toBe(
      "urn:ietf:params:scim:api:messages:2.0:Error",
    );
  });

  it("uses the RFC 7644 §3.4.2 ListResponse schema URN", () => {
    expect(SCIM_LIST_RESPONSE_SCHEMA_URN).toBe(
      "urn:ietf:params:scim:api:messages:2.0:ListResponse",
    );
  });

  it("uses the RFC 7644 §3.5.2 PatchOp schema URN", () => {
    expect(SCIM_PATCH_OP_SCHEMA_URN).toBe(
      "urn:ietf:params:scim:api:messages:2.0:PatchOp",
    );
  });

  describe("SCIM_SCHEMAS", () => {
    it("contains exactly the six required keys", () => {
      expect(Object.keys(SCIM_SCHEMAS).sort()).toEqual([
        "CORE_GROUP",
        "CORE_USER",
        "ENTERPRISE_USER",
        "RESOURCE_TYPE",
        "SCHEMA",
        "SERVICE_PROVIDER_CONFIG",
      ]);
    });

    it("maps CORE_USER to the RFC 7643 §4.1 User URN", () => {
      expect(SCIM_SCHEMAS.CORE_USER).toBe(
        "urn:ietf:params:scim:schemas:core:2.0:User",
      );
    });

    it("maps CORE_GROUP to the RFC 7643 §4.2 Group URN", () => {
      expect(SCIM_SCHEMAS.CORE_GROUP).toBe(
        "urn:ietf:params:scim:schemas:core:2.0:Group",
      );
    });

    it("maps ENTERPRISE_USER to the RFC 7643 §4.1.2 extension URN", () => {
      expect(SCIM_SCHEMAS.ENTERPRISE_USER).toBe(
        "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
      );
    });

    it("maps SERVICE_PROVIDER_CONFIG to the RFC 7643 §6 URN", () => {
      expect(SCIM_SCHEMAS.SERVICE_PROVIDER_CONFIG).toBe(
        "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig",
      );
    });

    it("maps RESOURCE_TYPE to the RFC 7643 §6 URN", () => {
      expect(SCIM_SCHEMAS.RESOURCE_TYPE).toBe(
        "urn:ietf:params:scim:schemas:core:2.0:ResourceType",
      );
    });

    it("maps SCHEMA to the RFC 7643 §7 URN", () => {
      expect(SCIM_SCHEMAS.SCHEMA).toBe(
        "urn:ietf:params:scim:schemas:core:2.0:Schema",
      );
    });
  });

  describe("ScimSchema type", () => {
    it("accepts every value from SCIM_SCHEMAS at compile time", () => {
      // Pure type-level assertion: each value of SCIM_SCHEMAS must be
      // assignable to ScimSchema. Runtime check is incidental — failure would
      // be a tsc error first.
      const values: ScimSchema[] = Object.values(SCIM_SCHEMAS);
      expect(values).toHaveLength(6);
    });
  });

  describe("SCIM token auth constants", () => {
    it("exports SCIM_TOKEN_PREFIX as the wire-stable bearer prefix", () => {
      expect(SCIM_TOKEN_PREFIX).toBe("tps_");
      expect(typeof SCIM_TOKEN_PREFIX).toBe("string");
    });

    it("exports SCIM_SYSTEM_USER_EMAIL as the sentinel synthetic-user email", () => {
      expect(SCIM_SYSTEM_USER_EMAIL).toBe("scim@__system__");
      expect(typeof SCIM_SYSTEM_USER_EMAIL).toBe("string");
    });

    it("exports SCIM_SYSTEM_USER_ID as the deterministic synthetic-user id", () => {
      expect(SCIM_SYSTEM_USER_ID).toBe("system-scim-user");
      expect(typeof SCIM_SYSTEM_USER_ID).toBe("string");
    });

    it("exports SCIM_LAST_USED_THROTTLE_MS as a 60-second window", () => {
      expect(SCIM_LAST_USED_THROTTLE_MS).toBe(60_000);
      expect(typeof SCIM_LAST_USED_THROTTLE_MS).toBe("number");
    });
  });
});
