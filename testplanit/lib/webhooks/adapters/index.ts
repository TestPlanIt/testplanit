import type { AdapterType } from "@prisma/client";
import { jiraAdapter } from "./jira";
import type { WebhookAdapter } from "./types";

/**
 * Registry of INBOUND webhook adapters keyed by AdapterType.
 *
 * Phase 1 ships JIRA only; GITHUB and AZURE_DEVOPS slot in during Phase 3.
 *
 * Phase 2 added SLACK and GENERIC_HMAC values to the AdapterType enum but
 * they are OUTBOUND-only — outbound dispatch lives in
 * workers/webhook-dispatch-worker.ts, not in this inbound receiver registry.
 * Mapping them to `null` here keeps the Record exhaustive; the inbound
 * receiver throws if it ever encounters a config row with those types
 * (would indicate a misconfigured WebhookConfig row with direction=INBOUND
 * + adapterType=SLACK, which the admin form prevents).
 *
 * Exhaustive Record (LO-05): a future `AdapterType` enum value forces a
 * compile-time decision here rather than a runtime "Unknown adapter" 501 at
 * request time. `null` placeholders represent "enum value exists, adapter
 * not implemented for inbound" — the receiver maps that to 501.
 */
export const ADAPTER_REGISTRY: Record<AdapterType, WebhookAdapter | null> = {
  JIRA: jiraAdapter,
  GITHUB: null,
  AZURE_DEVOPS: null,
  SLACK: null,
  GENERIC_HMAC: null,
};

/**
 * Look up the inbound adapter for a given AdapterType. Throws if unknown,
 * not yet implemented, or outbound-only — the receiver catches and returns
 * 501/500.
 */
export function getAdapter(adapterType: AdapterType): WebhookAdapter {
  const adapter = ADAPTER_REGISTRY[adapterType];
  if (!adapter) {
    if (adapterType === "GITHUB" || adapterType === "AZURE_DEVOPS") {
      throw new Error(
        `Adapter not implemented for adapterType=${adapterType} (deferred to Phase 3)`
      );
    }
    if (adapterType === "SLACK" || adapterType === "GENERIC_HMAC") {
      throw new Error(
        `Adapter ${adapterType} is OUTBOUND-only (Phase 2); inbound receiver should never see this type`
      );
    }
    throw new Error(`Unknown adapter type: ${adapterType}`);
  }
  return adapter;
}
