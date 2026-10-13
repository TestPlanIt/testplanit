/** What a viewer shows about a frozen report: when, by whom, and how complete. */
export interface FrozenReportMeta {
  capturedAt: string;
  capturedByName: string | null;
  rowCount: number;
  totalRowCount: number;
  truncated: boolean;
}

export function frozenReportMeta(snapshot: {
  capturedAt: Date;
  capturedBy?: { name: string | null } | null;
  rowCount: number;
  totalRowCount: number;
  truncated: boolean;
}): FrozenReportMeta {
  return {
    capturedAt: snapshot.capturedAt.toISOString(),
    capturedByName: snapshot.capturedBy?.name ?? null,
    rowCount: snapshot.rowCount,
    totalRowCount: snapshot.totalRowCount,
    truncated: snapshot.truncated,
  };
}
