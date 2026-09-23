"use client";

import { useMemo } from "react";
import {
  describeParamInputs,
  normalizeParamSchema,
} from "~/lib/execution/params";
import type { TestRunExecutionRow } from "~/hooks/useTestRunExecutions";

/**
 * The parameters an execution was requested with, labelled by the target's
 * declared parameters: one "Label: value" line per input. Renders nothing
 * when the execution carried no inputs.
 */
export function useExecutionInputs(
  execution: Pick<TestRunExecutionRow, "inputs" | "target"> | null | undefined
) {
  return useMemo(
    () =>
      execution
        ? describeParamInputs(
            normalizeParamSchema(execution.target?.paramSchema),
            execution.inputs
          )
        : [],
    [execution]
  );
}

export function ExecutionInputsList({
  execution,
  className,
}: {
  execution: Pick<TestRunExecutionRow, "inputs" | "target">;
  className?: string;
}) {
  const inputs = useExecutionInputs(execution);
  if (inputs.length === 0) return null;
  return (
    <dl className={className} data-testid="automation-execution-inputs">
      {inputs.map((input) => (
        <div key={input.name} className="flex gap-1">
          <dt className="shrink-0 text-muted-foreground">{input.label}:</dt>
          <dd className="min-w-0 break-words">
            {input.values.length > 0 ? input.values.join(", ") : "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}
