import { AuditAction } from "~/zenstack/models";

/**
 * Every action the audit log can record, derived from the schema enum and
 * sorted alphabetically for the filter pickers. Adding a value to
 * `enum AuditAction` in schema.zmodel is enough to surface it in the UI.
 */
export const AUDIT_ACTIONS: AuditAction[] = (
  Object.values(AuditAction) as AuditAction[]
)
  .slice()
  .sort();

/**
 * Render an action for display: `SHARE_LINK_CREATED` -> `SHARE LINK CREATED`.
 */
export function formatAuditAction(action: AuditAction | string): string {
  return action.replace(/_/g, " ");
}
