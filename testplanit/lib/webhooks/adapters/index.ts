import type { AdapterType } from "@prisma/client";
import { jiraAdapter } from "./jira";
import type { WebhookAdapter } from "./types";

/**
 * Registry of inbound webhook adapters keyed by AdapterType.
 *
 * Phase 1 ships JIRA only; GITHUB and AZURE_DEVOPS slot in during Phase 3.
 *
 * Exhaustive Record (LO-05): a future `AdapterType` enum value forces a
 * compile-time decision here rather than a runtime "Unknown adapter" 501 at
 * request time. `null` placeholders represent "enum value exists, adapter
 * not yet implemented" — the receiver maps that to 501 (Not Implemented).
 */
export const ADAPTER_REGISTRY: Record<AdapterType, WebhookAdapter | null> = {
  JIRA: jiraAdapter,
  GITHUB: null,
  AZURE_DEVOPS: null,
};

/**
 * Look up the adapter for a given AdapterType. Throws if unknown or
 * not yet implemented — the receiver catches and returns 501/500.
 */
export function getAdapter(adapterType: AdapterType): WebhookAdapter {
  const adapter = ADAPTER_REGISTRY[adapterType];
  if (!adapter) {
    if (adapterType === "GITHUB" || adapterType === "AZURE_DEVOPS") {
      throw new Error(
        `Adapter not implemented for adapterType=${adapterType} (deferred to Phase 3)`
      );
    }
    throw new Error(`Unknown adapter type: ${adapterType}`);
  }
  return adapter;
}
