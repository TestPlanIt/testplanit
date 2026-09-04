"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AnalysisWarning,
  CaseTier,
  ImpactProgress,
  ReasonKind,
  SelectionReason,
  StalePin,
} from "~/lib/services/impact/types";

export const IMPACT_POLL_INTERVAL_MS = 2000;
export const IMPACT_MAX_POLL_ATTEMPTS = 300;

export type ImpactAnalysisStatus =
  "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type ImpactAnalysisErrorCode =
  | "disabled"
  | "noConfig"
  | "queue"
  | "timeout"
  | "cancelled"
  | "analysisFailed"
  | "generic";

export interface ImpactAnalysisError {
  code: ImpactAnalysisErrorCode;
  message?: string;
}

export interface ImpactAnalysisResultPayload {
  summary: string;
  stalePins: StalePin[];
  uncoveredFiles: string[];
  warnings: AnalysisWarning[];
  stats?: {
    ai?: { tokens?: { total: number } };
    [key: string]: unknown;
  };
}

export interface ImpactAnalysisRow {
  id: number;
  status: ImpactAnalysisStatus;
  error: string | null;
  baseSha: string;
  headSha: string;
  fileCount: number;
  additions: number;
  deletions: number;
  truncated: boolean;
  affectedCaseCount: number;
  pinnedCaseCount: number;
  result: ImpactAnalysisResultPayload | null;
}

export interface ImpactAnalysisCaseRow {
  caseId: number;
  score: number;
  tier: CaseTier;
  layers: ReasonKind[];
  reasons: SelectionReason[];
  coveredFiles: string[];
  case: {
    id: number;
    name: string;
    automated: boolean;
    folder: { id: number; name: string } | null;
  };
}

export interface ImpactAnalysisPayload {
  analysis: ImpactAnalysisRow;
  cases: ImpactAnalysisCaseRow[];
  progress: ImpactProgress | null;
  jobState: string | null;
}

export interface StartImpactAnalysisInput {
  base: string;
  head: string;
  notes?: string;
  excludeCaseIds?: number[];
  /** Skip the recent-analysis reuse and run fresh. */
  force?: boolean;
}

export interface StartImpactAnalysisResult {
  analysisId: number;
  reused: boolean;
  aiAvailable: boolean;
}

export class ImpactStartError extends Error {
  code: ImpactAnalysisErrorCode;

  constructor(code: ImpactAnalysisErrorCode, message: string) {
    super(message);
    this.name = "ImpactStartError";
    this.code = code;
  }
}

function toStartErrorCode(
  httpStatus: number,
  code: unknown
): ImpactAnalysisErrorCode {
  if (code === "impact_disabled") return "disabled";
  if (code === "no_impact_config") return "noConfig";
  if (httpStatus === 503) return "queue";
  return "generic";
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function useImpactAnalysis(projectId: number) {
  const [analysisId, setAnalysisId] = useState<number | null>(null);
  const [status, setStatus] = useState<ImpactAnalysisStatus | null>(null);
  const [progress, setProgress] = useState<ImpactProgress | null>(null);
  const [result, setResult] = useState<ImpactAnalysisPayload | null>(null);
  const [error, setError] = useState<ImpactAnalysisError | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const analysisIdRef = useRef<number | null>(null);

  const basePath = `/api/projects/${projectId}/impact/analyses`;

  const abortCurrent = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  const poll = useCallback(
    async (id: number, controller: AbortController) => {
      let attempts = 0;
      try {
        while (attempts < IMPACT_MAX_POLL_ATTEMPTS) {
          const response = await fetch(`${basePath}/${id}`, {
            signal: controller.signal,
          });
          const data = (await response.json()) as ImpactAnalysisPayload & {
            error?: string;
          };
          if (controller.signal.aborted) return;
          if (!response.ok) {
            throw new Error(data.error || "Failed to load analysis");
          }

          setResult(data);
          setProgress(data.progress ?? null);
          const nextStatus = data.analysis.status;
          setStatus(nextStatus);

          if (nextStatus === "COMPLETED") return;
          if (nextStatus === "FAILED") {
            setError({
              code: "analysisFailed",
              message: data.analysis.error ?? undefined,
            });
            return;
          }
          if (nextStatus === "CANCELLED") {
            setError({ code: "cancelled" });
            return;
          }

          attempts++;
          await sleep(IMPACT_POLL_INTERVAL_MS, controller.signal);
          if (controller.signal.aborted) return;
        }
        setStatus("FAILED");
        setError({ code: "timeout" });
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof Error && err.name === "AbortError") return;
        setStatus("FAILED");
        setError({
          code: "generic",
          message: err instanceof Error ? err.message : undefined,
        });
      }
    },
    [basePath]
  );

  const start = useCallback(
    async (
      input: StartImpactAnalysisInput
    ): Promise<StartImpactAnalysisResult> => {
      abortCurrent();
      const controller = new AbortController();
      abortRef.current = controller;

      setAnalysisId(null);
      analysisIdRef.current = null;
      setStatus("PENDING");
      setProgress(null);
      setResult(null);
      setError(null);

      let response: Response;
      let data: {
        analysisId?: number;
        reused?: boolean;
        aiAvailable?: boolean;
        error?: string;
        code?: string;
      };
      try {
        response = await fetch(basePath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            base: input.base,
            head: input.head,
            notes: input.notes,
            excludeCaseIds:
              input.excludeCaseIds && input.excludeCaseIds.length > 0
                ? input.excludeCaseIds
                : undefined,
            force: input.force ? true : undefined,
          }),
          signal: controller.signal,
        });
        data = await response.json();
      } catch (err) {
        if (controller.signal.aborted) {
          throw new ImpactStartError("cancelled", "Cancelled");
        }
        const message = err instanceof Error ? err.message : "Request failed";
        setStatus("FAILED");
        setError({ code: "generic", message });
        throw new ImpactStartError("generic", message);
      }

      if (!response.ok || typeof data.analysisId !== "number") {
        const code = toStartErrorCode(response.status, data.code);
        const message = data.error || "Failed to start analysis";
        setStatus("FAILED");
        setError({ code, message });
        throw new ImpactStartError(code, message);
      }

      const id = data.analysisId;
      setAnalysisId(id);
      analysisIdRef.current = id;
      void poll(id, controller);

      return {
        analysisId: id,
        reused: data.reused === true,
        aiAvailable: data.aiAvailable !== false,
      };
    },
    [abortCurrent, basePath, poll]
  );

  const cancel = useCallback(() => {
    const id = analysisIdRef.current;
    abortCurrent();
    if (id !== null) {
      fetch(`${basePath}/${id}/cancel`, { method: "POST" }).catch(() => {});
    }
    setStatus((prev) =>
      prev === "COMPLETED" || prev === "FAILED" || prev === null
        ? prev
        : "CANCELLED"
    );
    setProgress(null);
  }, [abortCurrent, basePath]);

  const reset = useCallback(() => {
    abortCurrent();
    analysisIdRef.current = null;
    setAnalysisId(null);
    setStatus(null);
    setProgress(null);
    setResult(null);
    setError(null);
  }, [abortCurrent]);

  return { start, analysisId, status, progress, result, error, cancel, reset };
}
