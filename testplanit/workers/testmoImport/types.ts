export interface ActivitySummaryEntry {
  type: "summary";
  timestamp: string;
  entity: string;
  total: number;
  created: number;
  mapped: number;
  details?: Record<string, unknown>;
}

export interface ActivityMessageEntry {
  type: "message";
  timestamp: string;
  message: string;
  details?: Record<string, unknown>;
}

export type ActivityLogEntry = ActivitySummaryEntry | ActivityMessageEntry;

export type EntitySummaryResult = Omit<ActivitySummaryEntry, "type" | "timestamp">;

export interface ImportContext {
  activityLog: ActivityLogEntry[];
  entityProgress: Record<
    string,
    { total: number; created: number; mapped: number }
  >;
  processedCount: number;
  startTime: number;
  lastProgressUpdate: number;
  jobId: string;
}

export type PersistProgressFn = (
  entity: string | null,
  statusMessage?: string
) => Promise<void>;
