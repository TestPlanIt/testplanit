/**
 * Which trackers TestPlanIt can sync milestones from, and the milestone
 * kinds each one offers. Mirrors each adapter's `getCapabilities().milestones`
 * so client code (settings, the milestones page, the import dialog) can gate
 * on a static fact without a server round trip. Keep in step with
 * `lib/integrations/adapters/*Adapter.ts`.
 */
export type MilestoneSyncKind = "RELEASE" | "ITERATION";

export const MILESTONE_KINDS_BY_PROVIDER: Record<string, MilestoneSyncKind[]> =
  {
    JIRA: ["RELEASE", "ITERATION"],
    GITHUB: ["RELEASE"],
  };

export const MILESTONE_SYNC_PROVIDERS: string[] = Object.keys(
  MILESTONE_KINDS_BY_PROVIDER
);

export function isMilestoneSyncProvider(provider: string | null | undefined) {
  return !!provider && provider in MILESTONE_KINDS_BY_PROVIDER;
}

const ALL_KINDS: MilestoneSyncKind[] = ["RELEASE", "ITERATION"];

/**
 * Returns the same array instance for the same provider: callers put it in
 * hook dependency lists, and a fresh array per call would re-run them on
 * every render.
 */
export function milestoneKindsFor(
  provider: string | null | undefined
): MilestoneSyncKind[] {
  const kinds = provider ? MILESTONE_KINDS_BY_PROVIDER[provider] : undefined;
  return kinds ?? ALL_KINDS;
}
