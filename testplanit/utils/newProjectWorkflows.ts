/**
 * The workflow states a new project is given: the ones picked in the project
 * wizard, and every AI-draft test case state that is switched off. The wizard
 * offers only states that are switched on, so a project created while an
 * AI-draft state is off would otherwise be without it once the state is
 * switched on.
 */
export function workflowIdsForNewProject(
  selectedWorkflowIds: readonly number[],
  switchedOffAiDraftStates: readonly { id: number }[] | null | undefined
): number[] {
  return [
    ...new Set([
      ...selectedWorkflowIds,
      ...(switchedOffAiDraftStates ?? []).map((state) => state.id),
    ]),
  ];
}
