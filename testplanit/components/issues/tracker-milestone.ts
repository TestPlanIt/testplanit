/** The tracker milestone a TestPlanIt milestone is synced from. */
export interface TrackerMilestoneRef {
  integrationId: number;
  externalId: string;
  kind: "RELEASE" | "ITERATION" | null;
  name: string;
}
