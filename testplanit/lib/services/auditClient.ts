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
