"use client";

import type { TestCaseParameter } from "@prisma/client";

export interface ParametersTabProps {
  caseId: number;
  projectId: number;
  parameters: TestCaseParameter[];
}

/**
 * Placeholder shipped in Task 1 of plan 02-03 so the Sheet shell
 * compiles. The real Add-form + sortable-list implementation lands
 * in Task 2 of the same plan.
 */
export function ParametersTab(_props: ParametersTabProps) {
  return <div data-testid="parameters-tab-placeholder" />;
}
