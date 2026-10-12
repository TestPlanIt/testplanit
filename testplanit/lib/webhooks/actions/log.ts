/** One WebhookActionLog row; failures to write it never fail the action. */
export async function logWebhookAction(
  db: any,
  entry: {
    webhookActionId: string | null;
    webhookConfigId: string;
    deliveryId?: string | null;
    projectId: number;
    outcome: string;
    issueId?: number | null;
    analysisId?: number | null;
    testRunId?: number | null;
    caseCount?: number | null;
    detail?: string | null;
  }
): Promise<void> {
  await db.webhookActionLog
    .create({
      data: {
        webhookActionId: entry.webhookActionId,
        webhookConfigId: entry.webhookConfigId,
        deliveryId: entry.deliveryId ?? null,
        projectId: entry.projectId,
        outcome: entry.outcome,
        issueId: entry.issueId ?? null,
        analysisId: entry.analysisId ?? null,
        testRunId: entry.testRunId ?? null,
        caseCount: entry.caseCount ?? null,
        detail: entry.detail ? entry.detail.slice(0, 500) : null,
      },
    })
    .catch((error: unknown) =>
      console.error("[webhook-actions] log write failed", error)
    );
}
