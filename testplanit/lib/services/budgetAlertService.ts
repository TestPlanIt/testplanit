import { NotificationType } from "@prisma/client";
import { NotificationService } from "./notificationService";

export const THRESHOLDS = [80, 90, 100] as const;

export interface BudgetCheckResult {
  checked: boolean;
  thresholdsCrossed: number[];
  currentSpend: number;
  budget: number;
}

/**
 * Pure budget check and alert business logic service.
 *
 * Checks whether an LLM provider's current month spend has crossed any
 * budget threshold (80%, 90%, 100%) and, if so, notifies all ADMIN users
 * exactly once per threshold per billing month through the existing
 * notification pipeline.
 *
 * This service is intentionally BullMQ-unaware so that it can be tested
 * with mocked Prisma clients without queue infrastructure.
 */
export class BudgetAlertService {
  constructor(private prisma: any) {}

  async checkAndAlert(
    llmIntegrationId: number,
    tenantId?: string
  ): Promise<BudgetCheckResult> {
    const notChecked: BudgetCheckResult = {
      checked: false,
      thresholdsCrossed: [],
      currentSpend: 0,
      budget: 0,
    };

    // 1. Fetch provider config with integration details
    const config = await this.prisma.llmProviderConfig.findUnique({
      where: { llmIntegrationId },
      include: {
        llmIntegration: { select: { name: true, isDeleted: true } },
      },
    });

    // Provider not found or deleted -- exit early
    if (!config || !config.llmIntegration || config.llmIntegration.isDeleted) {
      console.debug(
        `[BudgetAlert] Provider not found or deleted for integration ${llmIntegrationId}, skipping`
      );
      return notChecked;
    }

    // No budget set or zero budget -- exit early
    const budget = Number(config.monthlyBudget);
    if (!config.monthlyBudget || budget <= 0) {
      console.debug(
        `[BudgetAlert] No budget set for integration ${llmIntegrationId}, skipping`
      );
      return notChecked;
    }

    // 2. Aggregate current month spend
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const result = await this.prisma.llmUsage.aggregate({
      where: {
        llmIntegrationId,
        createdAt: { gte: startOfMonth },
      },
      _sum: { totalCost: true },
    });

    const currentSpend = Number(result._sum.totalCost ?? 0);
    const spendPercent = (currentSpend / budget) * 100;

    // 3. Determine which thresholds are crossed but not yet fired
    const monthKey = `${startOfMonth.getFullYear()}-${String(startOfMonth.getMonth() + 1).padStart(2, "0")}`;
    const fired =
      (config.alertThresholdsFired as Record<string, number[]>) ?? {};
    const firedForMonth = fired[monthKey] ?? [];

    const newlyCrossed = THRESHOLDS.filter(
      (t) => spendPercent >= t && !firedForMonth.includes(t)
    );

    if (newlyCrossed.length === 0) {
      console.debug(
        `[BudgetAlert] No new thresholds crossed for integration ${llmIntegrationId} (${spendPercent.toFixed(1)}%)`
      );
      return { checked: true, thresholdsCrossed: [], currentSpend, budget };
    }

    // 4. Atomically update alertThresholdsFired before sending notifications
    const updatedFired = {
      ...fired,
      [monthKey]: [...firedForMonth, ...newlyCrossed],
    };

    await this.prisma.llmProviderConfig.update({
      where: { id: config.id },
      data: { alertThresholdsFired: updatedFired },
    });

    // 5. Send notifications to all ADMIN users
    const admins = await this.prisma.user.findMany({
      where: { access: "ADMIN", isActive: true, isDeleted: false },
      select: { id: true },
    });

    const providerName = config.llmIntegration.name;

    for (const threshold of newlyCrossed) {
      const title = this.getNotificationTitle(threshold);
      const message = this.getNotificationMessage(
        providerName,
        currentSpend,
        budget,
        threshold
      );

      for (const admin of admins) {
        await NotificationService.createNotification({
          userId: admin.id,
          type: NotificationType.LLM_BUDGET_ALERT,
          title,
          message,
          relatedEntityType: "LlmProviderConfig",
          relatedEntityId: String(config.llmIntegrationId),
          data: {
            providerName,
            currentSpend: currentSpend.toFixed(2),
            budgetLimit: budget.toFixed(2),
            threshold,
            monthKey,
            link: "/admin/llm",
          },
          tenantId,
        });
      }
    }

    console.info(
      `[BudgetAlert] Thresholds ${newlyCrossed.join(",")}% crossed for "${providerName}" ($${currentSpend.toFixed(2)}/$${budget.toFixed(2)}). Notified ${admins.length} admins.`
    );

    return {
      checked: true,
      thresholdsCrossed: [...newlyCrossed],
      currentSpend,
      budget,
    };
  }

  /**
   * Get notification title based on threshold level.
   * - 80%: neutral warning
   * - 90%: firm warning
   * - 100%: urgent alert
   */
  private getNotificationTitle(threshold: number): string {
    if (threshold >= 100) {
      return "LLM Budget Exceeded";
    }
    return `LLM Budget ${threshold}% Used`;
  }

  /**
   * Get notification message (main body only, no disclaimer).
   */
  private getNotificationMessage(
    providerName: string,
    currentSpend: number,
    budget: number,
    threshold: number
  ): string {
    const spendFormatted = `$${currentSpend.toFixed(2)}`;
    const budgetFormatted = `$${budget.toFixed(2)}`;

    if (threshold >= 100) {
      return `${providerName} has exceeded its monthly budget: ${spendFormatted} spent of ${budgetFormatted} budget.`;
    }
    return `${providerName} has used ${threshold}% of its monthly budget: ${spendFormatted} of ${budgetFormatted}.`;
  }
}
