/**
 * Best-effort feedback write: which affected tests the reviewer kept and the
 * run they went into. Failures are logged, never surfaced; the run itself is
 * unaffected.
 */
export async function recordImpactAcceptance(
  projectId: number,
  analysisId: number,
  body: {
    testRunId?: number;
    acceptedCaseIds: number[];
    addedCaseIds?: number[];
  }
): Promise<void> {
  try {
    const response = await fetch(
      `/api/projects/${projectId}/impact/analyses/${analysisId}/cases`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    if (!response.ok) {
      console.warn("[impact] acceptance not recorded:", response.status);
    }
  } catch (error) {
    console.warn("[impact] acceptance not recorded:", error);
  }
}
