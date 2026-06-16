/**
 * Client-side audit logging helpers.
 * These functions call the audit API endpoints to log events from the browser.
 */

/**
 * Log a data export event.
 * Should be called after a successful export from the client.
 */
export async function logDataExport(params: {
  exportType: string;
  entityType: string;
  recordCount?: number;
  filters?: Record<string, unknown>;
  projectId?: number;
}): Promise<void> {
  try {
    const response = await fetch("/api/audit/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      console.warn("[AuditClient] Failed to log export:", response.statusText);
    }
  } catch (error) {
    // Don't throw - audit logging should never break the user experience
    console.warn("[AuditClient] Error logging export:", error);
  }
}

/**
 * Record a consolidated audit entry for a test-case content edit (custom field
 * values, steps, tags, issues, parameters). Call after a successful case save,
 * once every write has landed, so the diff against the previous version
 * snapshot is complete.
 */
export async function logCaseContentChange(caseId: number): Promise<void> {
  try {
    const response = await fetch("/api/audit/case-version", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ caseId }),
    });

    if (!response.ok) {
      console.warn(
        "[AuditClient] Failed to log case content change:",
        response.statusText
      );
    }
  } catch (error) {
    // Don't throw - audit logging should never break the user experience
    console.warn("[AuditClient] Error logging case content change:", error);
  }
}
