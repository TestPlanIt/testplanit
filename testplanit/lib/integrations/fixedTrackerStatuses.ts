/**
 * Trackers whose issues have only fixed states, by provider, named as their
 * adapters store them on synced issues. Listing them needs no credentials.
 */
export const FIXED_TRACKER_STATUSES: Record<
  string,
  ReadonlyArray<{ id: string; name: string }>
> = {
  GITHUB: [
    { id: "open", name: "open" },
    { id: "closed", name: "closed" },
  ],
  GITEA: [
    { id: "open", name: "open" },
    { id: "closed", name: "closed" },
  ],
  GITLAB: [
    { id: "opened", name: "opened" },
    { id: "closed", name: "closed" },
  ],
};
