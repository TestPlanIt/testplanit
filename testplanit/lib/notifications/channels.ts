// The ONLY module permitted to construct notifications channel-key strings.
// Architectural Directive 3 (REQUIREMENTS.md) / REQ PUB-03.

export function userChannel(tenantId: string, userId: string): string {
  if (!tenantId) throw new Error("channels.userChannel: tenantId is required");
  if (!userId) throw new Error("channels.userChannel: userId is required");
  return `notifications:tenant:${tenantId}:user:${userId}`;
}

export function tenantBroadcastChannel(tenantId: string): string {
  if (!tenantId)
    throw new Error("channels.tenantBroadcastChannel: tenantId is required");
  return `notifications:tenant:${tenantId}:broadcast`;
}
