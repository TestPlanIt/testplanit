"use client";

import type { TestCaseParameter } from "@prisma/client";

export interface ParameterRowProps {
  parameter: TestCaseParameter;
  caseId: number;
  projectId: number;
}

/**
 * Placeholder shipped in Task 2 of plan 02-03 so the ParametersTab
 * imports compile. The full row (drag handle, edit, delete, inline-edit
 * + 3 confirmation dialogs) lands in Task 3 of the same plan.
 */
export function ParameterRow({ parameter }: ParameterRowProps) {
  return (
    <div data-testid={`parameter-row-${parameter.id}`}>{parameter.name}</div>
  );
}
