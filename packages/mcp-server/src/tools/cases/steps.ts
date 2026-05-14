import { zenstack } from "../../api.js";
import type { EnvConfig } from "../../env.js";

export interface StepInput {
  text?: string | null;
  expectedResult?: string | null;
  order?: number;
}

/**
 * Wrap plain text in the minimal valid Tiptap ProseMirror doc structure.
 *
 * The TestPlanIt UI renders `Steps.step` and `Steps.expectedResult` via
 * Tiptap; passing a raw string would render as garbage. Agent-supplied text
 * must be wrapped before writing. Empty/null/undefined input produces a
 * paragraph node with no children (valid empty ProseMirror doc).
 */
export function wrapPlainTextInProseMirror(
  text: string | null | undefined,
): unknown {
  if (text == null || text === "") {
    return { type: "doc", content: [{ type: "paragraph", content: [] }] };
  }
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  };
}

/**
 * Create steps for a case in order. Called by create.ts AFTER the case row
 * exists. Each step text is wrapped in ProseMirror format before writing.
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
          step: wrapPlainTextInProseMirror(step.text ?? ""),
          expectedResult:
            step.expectedResult != null
              ? wrapPlainTextInProseMirror(step.expectedResult)
              : null,
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
