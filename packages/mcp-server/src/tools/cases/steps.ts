import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";

export interface StepInput {
  text?: string | null;
  expectedResult?: string | null;
  order?: number;
}

/**
 * Create steps for a case in order. Called by create.ts AFTER the case row
 * exists. Step text is sent as the agent wrote it: the host converts a string
 * written to `Steps.step` / `Steps.expectedResult` into a Tiptap document
 * (Markdown, HTML or plain text), the same conversion the bulk-create route
 * and CSV import use, so every writer stores the same document.
 *
 * Sequential creates are used instead of createMany to ensure relation-connect
 * syntax (`testCase: { connect: { id } }`) works cleanly with ZenStack's RPC.
 */
export async function createStepsForCase(
  caseId: number,
  steps: StepInput[],
  env: EnvConfig,
): Promise<void> {
  for (const [index, step] of steps.entries()) {
    await zenstack(
      "steps",
      "create",
      {
        data: {
          testCase: { connect: { id: caseId } },
          order: step.order ?? index,
          step: step.text ?? "",
          expectedResult: step.expectedResult ?? null,
        },
      },
      env,
    );
  }
}

/**
 * Replace ALL non-deleted steps for a case. Soft-deletes existing steps via
 * `updateMany` (T-06-06: the `delete` and `deleteMany` operations are NEVER
 * used — soft-delete invariant), then creates the new ordered set.
 *
 * This is called by the update tool when `steps` is provided in the update
 * input — the full replacement strategy ensures ordering is always consistent.
 */
export async function replaceStepsForCase(
  caseId: number,
  steps: StepInput[],
  env: EnvConfig,
): Promise<void> {
  // Soft-delete all non-deleted steps for this case.
  await zenstack(
    "steps",
    "updateMany",
    {
      where: { testCaseId: caseId, isDeleted: false },
      data: { isDeleted: true },
    },
    env,
  );
  // Create the new ordered step set.
  await createStepsForCase(caseId, steps, env);
}
