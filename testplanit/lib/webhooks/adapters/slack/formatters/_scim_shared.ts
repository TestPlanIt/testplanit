import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { buildBody } from "./_shared";

/**
 * Shared helpers for SCIM lifecycle formatters. The SCIM events all run
 * under SYSTEM_PROJECT_ID, so the generic "in <projectName>" subtitle
 * surfaces "__system__" — meaningless to a Slack reader. SCIM formatters
 * skip the project line entirely and lead with the user/group identity
 * instead.
 *
 * Per-event color rules:
 *   - .created / .activated / .member_added → no color (informational
 *     additive events, often arrive in bursts)
 *   - .updated → no color (informational; the diff carries the signal)
 *   - .deactivated / .member_removed → COLOR_YELLOW (reversible state change)
 *   - .deleted → COLOR_RED (destructive, tombstoned in TestPlanIt)
 *   - .summary → no color (rollup, not an outcome)
 */

interface SnapshotLike {
  id?: unknown;
  name?: string | null;
  email?: string | null;
  userName?: string | null;
  scimExternalId?: string | null;
  externalId?: string | null;
  displayName?: string | null;
}

/** Resolve the deployed app base URL. NEXTAUTH_URL is the codebase precedent. */
function baseUrl(): string {
  return process.env.NEXTAUTH_URL ?? "http://localhost:3000";
}

/**
 * Locale-less paths. next-intl resolves the locale segment on the
 * receiving end based on the user's stored preference.
 */
export const scimUrl = {
  user: (userId: string): string => `${baseUrl()}/users/profile/${userId}`,
  group: (groupId: number): string =>
    `${baseUrl()}/admin/groups?focus=${groupId}`,
  scimAdmin: (): string => `${baseUrl()}/admin/scim`,
};

/**
 * `*Alice* (alice@example.com)` line — the canonical 1-line user
 * identity for SCIM lifecycle Slack messages. Falls back through name →
 * userName → email so the line is never empty even when the IdP didn't
 * send a name.
 *
 * When `opts.link` is false, the bold name is rendered without a
 * profile-page hyperlink (used by .deleted, since the row is tombstoned
 * and the profile page would 404).
 */
export function userIdentityLine(
  data: SnapshotLike,
  opts: { link?: boolean } = {}
): string {
  const link = opts.link ?? true;
  const display =
    (data.name && data.name.trim()) ||
    (data.userName && data.userName.trim()) ||
    (data.email && data.email.trim()) ||
    "Unknown user";
  const email = data.email && data.email.trim() ? data.email : null;
  const headline =
    link && typeof data.id === "string"
      ? `*<${scimUrl.user(data.id)}|${display}>*`
      : `*${display}*`;
  return email && email !== display ? `${headline} (${email})` : headline;
}

/**
 * `*Engineering*` line — the canonical 1-line group identity. Links to
 * the admin Groups page filtered to the row. Same `link` opt-out as
 * the user variant, used by .deleted.
 */
export function groupIdentityLine(
  data: SnapshotLike,
  opts: { link?: boolean } = {}
): string {
  const link = opts.link ?? true;
  const display =
    (data.displayName && data.displayName.trim()) ||
    (data.name && data.name.trim()) ||
    "Unknown group";
  if (link && typeof data.id === "number") {
    return `*<${scimUrl.group(data.id)}|${display}>*`;
  }
  return `*${display}*`;
}

/**
 * Footer line carrying the IdP's `externalId` so an admin can match the
 * event to the IdP's view of the same resource. Rendered as a small
 * monospace footer; omitted when no externalId was attached.
 */
export function externalIdFooter(externalId?: string | null): string | null {
  if (!externalId) return null;
  return `_IdP external id: \`${externalId}\`_`;
}

/**
 * Build a Slack body using the SCIM 2-line top pattern: bold header
 * + identity-line. Optional extra blocks (diff rows, member lists) get
 * appended in order. `previewText` is the notification-preview title.
 */
export function buildScimBody(args: {
  previewText: string;
  header: string;
  identityLine: string;
  extraBlocks?: Array<Record<string, unknown>>;
  footer?: string | null;
  color?: string;
}): FormattedHttpRequest {
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: args.header, emoji: false },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: args.identityLine },
    },
  ];

  if (args.extraBlocks?.length) {
    blocks.push(...args.extraBlocks);
  }

  if (args.footer) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: args.footer }],
    });
  }

  return buildBody({
    text: args.previewText,
    blocks,
    color: args.color,
  });
}

/**
 * Resolve an OutboundEnvelope to a snapshot-typed payload. Use this in
 * each formatter rather than redoing the cast.
 */
export function scimDataOf<T extends SnapshotLike>(
  envelope: OutboundEnvelope
): T {
  return envelope.data as unknown as T;
}
