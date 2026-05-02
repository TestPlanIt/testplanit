// The ONLY module permitted to construct issue-update SSE channel-key
// strings. Mirrors `lib/notifications/channels.ts` (Architectural
// Directive 3 / REQ PUB-03) — single legal channel-key constructor so a
// future audit grep `valkey publish` only ever surfaces strings minted
// here, never ad-hoc.
//
// Issue updates are scoped per-project (not per-user like notifications):
// many users share the same project's issues view, so one Valkey channel
// per (tenantId, projectId) fans out to every active SSE subscriber on
// that project. The SSE route handler is responsible for verifying the
// requesting user actually has read access to the project before
// subscribing.

export function projectIssueUpdateChannel(
  tenantId: string,
  projectId: number
): string {
  if (!tenantId)
    throw new Error(
      "issueUpdateChannels.projectIssueUpdateChannel: tenantId is required"
    );
  if (!Number.isInteger(projectId) || projectId <= 0)
    throw new Error(
      "issueUpdateChannels.projectIssueUpdateChannel: projectId must be a positive integer"
    );
  return `issue-updates:tenant:${tenantId}:project:${projectId}`;
}
