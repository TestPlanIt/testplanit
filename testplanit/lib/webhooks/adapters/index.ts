import type { AdapterType } from "@prisma/client";
import { jiraAdapter } from "./jira";
import type { WebhookAdapter } from "./types";

/**
 * Registry of inbound webhook adapters keyed by AdapterType.
 * Phase 1: only JIRA is implemented. GITHUB and AZURE_DEVOPS will slot in
 * during Phase 3 by adding entries here — no other code changes needed.
 */
export const ADAPTER_REGISTRY: Partial<Record<AdapterType, WebhookAdapter>> = {
  JIRA: jiraAdapter,
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
