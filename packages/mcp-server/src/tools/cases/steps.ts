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
          // An empty string stores the empty document, as the web UI does for a
          // step without an expected result.
          expectedResult: step.expectedResult ?? "",
        },
      },
      env,
    );
  }
}

/**
 * Replace ALL non-deleted steps for a case: create the new ordered set first,
 * then soft-delete the steps that were there before (by id, via `updateMany`;
 * the `delete` and `deleteMany` operations are NEVER used — soft-delete
 * invariant). Creating first means a rejected step leaves the case with its
 * old steps intact instead of half-replaced.
 *
 * This is called by the update tool when `steps` is provided in the update
 * input — the full replacement strategy ensures ordering is always consistent.
 */
export async function replaceStepsForCase(
  caseId: number,
  steps: StepInput[],
  env: EnvConfig,
): Promise<void> {
  const existing =
    (await zenstack<Array<{ id: number }>>(
      "steps",
      "findMany",
      {
        where: { testCaseId: caseId, isDeleted: false },
        select: { id: true },
      },
      env,
    )) ?? [];
  // Create the new ordered step set.
  await createStepsForCase(caseId, steps, env);
  // Then retire the previous set.
  if (existing.length > 0) {
    await zenstack(
      "steps",
      "updateMany",
      {
        where: { id: { in: existing.map((s) => s.id) } },
        data: { isDeleted: true },
      },
      env,
    );
  }
}
