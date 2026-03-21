"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PreflightResponse } from "~/app/api/repository/copy-move/schemas";
import type { CopyMoveJobResult, FolderTreeNode } from "~/workers/copyMoveWorker";

const POLL_INTERVAL_MS = 2000;

export type CopyMoveJobStatus =
  | "idle"
  | "prefighting"
  | "waiting"
  | "active"
  | "completed"
  | "failed";

export interface UseCopyMoveJobReturn {
  jobId: string | null;
  status: CopyMoveJobStatus;
  progress: { processed: number; total: number } | null;
  result: CopyMoveJobResult | null;
  preflight: PreflightResponse | null;
  error: string | null;
  isPrefighting: boolean;
  isSubmitting: boolean;
  runPreflight: (args: {
    operation: "copy" | "move";
    caseIds: number[];
    sourceProjectId: number;
    targetProjectId: number;
  }) => Promise<void>;
  submit: (args: {
    operation: "copy" | "move";
    caseIds: number[];
    sourceProjectId: number;
    targetProjectId: number;
    targetFolderId: number;
    conflictResolution: "skip" | "rename";
    sharedStepGroupResolution: "reuse" | "create_new";
    autoAssignTemplates?: boolean;
    targetRepositoryId?: number;
    targetDefaultWorkflowStateId?: number;
    targetTemplateId?: number;
    folderTree?: FolderTreeNode[];
  }) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
}

export function useCopyMoveJob(): UseCopyMoveJobReturn {
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<CopyMoveJobStatus>("idle");
  const [progress, setProgress] = useState<{
    processed: number;
    total: number;
  } | null>(null);
  const [result, setResult] = useState<CopyMoveJobResult | null>(null);
  const [preflight, setPreflight] = useState<PreflightResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPrefighting, setIsPrefighting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Track polling interval for cleanup
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track submit abort controller for cancellation during submit
  const submitAbortRef = useRef<AbortController | null>(null);

  // ── runPreflight ──────────────────────────────────────────────────────────

  const runPreflight = useCallback(
    async (args: {
      operation: "copy" | "move";
      caseIds: number[];
      sourceProjectId: number;
      targetProjectId: number;
    }) => {
      setIsPrefighting(true);
      setError(null);

      try {
        const res = await fetch("/api/repository/copy-move/preflight", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Preflight failed (${res.status})`);
        }

        const data = await res.json();
        setPreflight(data);
      } catch (err: any) {
        setError(err.message || "Preflight failed");
      } finally {
        setIsPrefighting(false);
      }
    },
    [],
  );

  // ── Submit ────────────────────────────────────────────────────────────────

  const submit = useCallback(
    async (args: {
      operation: "copy" | "move";
      caseIds: number[];
      sourceProjectId: number;
      targetProjectId: number;
      targetFolderId: number;
      conflictResolution: "skip" | "rename";
      sharedStepGroupResolution: "reuse" | "create_new";
      autoAssignTemplates?: boolean;
      targetRepositoryId?: number;
      targetDefaultWorkflowStateId?: number;
      targetTemplateId?: number;
      folderTree?: FolderTreeNode[];
    }) => {
      setIsSubmitting(true);
      setStatus("waiting");
      setError(null);
      setResult(null);
      setProgress(null);

      const abortController = new AbortController();
      submitAbortRef.current = abortController;

      try {
        const res = await fetch("/api/repository/copy-move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args),
          signal: abortController.signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Submit failed (${res.status})`);
        }

        const data = await res.json();

        // If cancelled while submit was in flight, cancel the newly created job
        if (abortController.signal.aborted) {
          fetch(`/api/repository/copy-move/cancel/${data.jobId}`, {
            method: "POST",
          }).catch(() => {});
          return;
        }

        setJobId(data.jobId);
      } catch (err: any) {
        if (err.name === "AbortError") return; // Cancelled by user
        setError(err.message || "Failed to submit copy-move job");
        setStatus("failed");
      } finally {
        submitAbortRef.current = null;
        setIsSubmitting(false);
      }
    },
    [],
  );

  // ── Polling ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!jobId || (status !== "waiting" && status !== "active")) {
      return;
    }

    const poll = async () => {
      try {
        const res = await fetch(`/api/repository/copy-move/status/${jobId}`);
        if (!res.ok) {
          throw new Error(`Status check failed (${res.status})`);
        }
        const data = await res.json();

        // Update progress only when values actually change to avoid
        // unnecessary re-renders (poll fires every 2s with same values)
        if (data.progress) {
          setProgress((prev) => {
            if (
              prev &&
              prev.processed === data.progress.processed &&
              prev.total === data.progress.total
            ) {
              return prev; // same reference → no re-render
            }
            return data.progress;
          });
        }

        const state = data.state as string;
        if (state === "completed") {
          setStatus("completed");
          if (data.result) {
            setResult(data.result);
          }
          // Stop polling
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        } else if (state === "failed") {
          setStatus("failed");
          setError(data.failedReason || "Job failed");
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        } else if (state === "active") {
          setStatus("active");
        }
        // "waiting" stays as-is
      } catch (err: any) {
        // Network error during poll -- don't stop, just log
        console.error("Copy-move poll error:", err);
      }
    };

    // Initial fetch immediately
    poll();

    // Then poll at interval
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [jobId, status]);

  // ── Cancel ────────────────────────────────────────────────────────────────

  const cancel = useCallback(async () => {
    // Abort in-flight submit request if still pending
    if (submitAbortRef.current) {
      submitAbortRef.current.abort();
      submitAbortRef.current = null;
    }

    if (jobId) {
      try {
        await fetch(`/api/repository/copy-move/cancel/${jobId}`, {
          method: "POST",
        });
      } catch {
        // Best effort -- cancel may fail if job already completed
      }
    }

    // Stop polling
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    setJobId(null);
    setStatus("idle");
    setProgress(null);
    setResult(null);
    setPreflight(null);
    setError(null);
    setIsPrefighting(false);
    setIsSubmitting(false);
  }, [jobId]);

  // ── Reset ─────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    setJobId(null);
    setStatus("idle");
    setProgress(null);
    setResult(null);
    setPreflight(null);
    setError(null);
    setIsPrefighting(false);
    setIsSubmitting(false);
  }, []);

  return useMemo(
    () => ({
      jobId,
      status,
      progress,
      result,
      preflight,
      error,
      isPrefighting,
      isSubmitting,
      runPreflight,
      submit,
      cancel,
      reset,
    }),
    [
      jobId,
      status,
      progress,
      result,
      preflight,
      error,
      isPrefighting,
      isSubmitting,
      runPreflight,
      submit,
      cancel,
      reset,
    ],
  );
}
