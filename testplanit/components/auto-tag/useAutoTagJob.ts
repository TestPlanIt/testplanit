"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EntityType } from "~/lib/llm/services/auto-tag/types";
import type {
  AutoTagJobState, AutoTagSelection, AutoTagSuggestionEntity, UseAutoTagJobReturn
} from "./types";

const POLL_INTERVAL_MS = 1000;

// ── localStorage helpers (SSR-safe) ──────────────────────────────────────

function getPersistedJobId(key: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(key);
}

function persistJobId(key: string, jobId: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, jobId);
}

function clearPersistedJobId(key: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(key);
}

/** Initialize selections with all tags accepted (opt-out model) */
function initSelections(
  suggestions: AutoTagSuggestionEntity[],
): AutoTagSelection {
  const map = new Map<number, Set<string>>();
  for (const entity of suggestions) {
    map.set(
      entity.entityId,
      new Set(entity.tags.map((t) => t.tagName)),
    );
  }
  return map;
}

export function useAutoTagJob(persistKey?: string): UseAutoTagJobReturn {
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<AutoTagJobState>("idle");
  const [progress, setProgress] = useState<{
    analyzed: number;
    total: number;
    finalizing?: boolean;
    streaming?: boolean;
    sizing?: number;
  } | null>(null);
  const [suggestions, setSuggestions] = useState<
    AutoTagSuggestionEntity[] | null
  >(null);
  const [selections, setSelections] = useState<AutoTagSelection>(new Map());
  const [edits, setEdits] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Set of existing project tag names (captured when suggestions arrive)
  const existingTagNamesRef = useRef<Set<string>>(new Set());

  // Track polling interval for cleanup
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track submit abort controller for cancellation during submit
  const submitAbortRef = useRef<AbortController | null>(null);

  // ── Submit ──────────────────────────────────────────────────────────────

  const submit = useCallback(
    async (
      entityIds: number[],
      entityType: EntityType,
      projectId: number,
      options?: { allowNewTags?: boolean },
    ) => {
      setIsSubmitting(true);
      setStatus("waiting");
      setError(null);
      setSuggestions(null);
      setSelections(new Map());
      setEdits(new Map());
      setProgress(null);

      const abortController = new AbortController();
      submitAbortRef.current = abortController;

      try {
        const payload: {
          entityIds: number[];
          entityType: EntityType;
          projectId: number;
          allowNewTags?: boolean;
        } = { entityIds, entityType, projectId };

        if (options?.allowNewTags !== undefined) {
          payload.allowNewTags = options.allowNewTags;
        }

        const res = await fetch("/api/auto-tag/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: abortController.signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Submit failed (${res.status})`);
        }

        const data = await res.json();

        // If cancelled while submit was in flight, cancel the newly created job
        if (abortController.signal.aborted) {
          fetch(`/api/auto-tag/cancel/${data.jobId}`, { method: "POST" }).catch(() => {});
          return;
        }

        setJobId(data.jobId);
        if (persistKey) persistJobId(persistKey, data.jobId);
      } catch (err: any) {
        if (err.name === "AbortError") return; // Cancelled by user
        setError(err.message || "Failed to submit auto-tag job");
        setStatus("failed");
      } finally {
        submitAbortRef.current = null;
        setIsSubmitting(false);
      }
    },
    [persistKey],
  );

  // ── Restore persisted job on mount ─────────────────────────────────────

  useEffect(() => {
    if (!persistKey) return;
    const stored = getPersistedJobId(persistKey);
    if (stored && status === "idle") {
      setJobId(stored);
      setStatus("waiting"); // triggers polling useEffect
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistKey]); // only on mount

  // ── Polling ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!jobId || (status !== "waiting" && status !== "active")) {
      return;
    }

    const poll = async () => {
      try {
        const res = await fetch(`/api/auto-tag/status/${jobId}`);
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
              prev.analyzed === data.progress.analyzed &&
              prev.total === data.progress.total &&
              prev.finalizing === data.progress.finalizing &&
              prev.streaming === data.progress.streaming &&
              prev.sizing === data.progress.sizing
            ) {
              return prev; // same reference → no re-render
            }
            return data.progress;
          });
        }

        // Map BullMQ state to our state type
        const state = data.state as string;
        if (state === "completed") {
          setStatus("completed");
          if (persistKey) clearPersistedJobId(persistKey);

          if (data.result?.suggestions) {
            const sug = data.result.suggestions as AutoTagSuggestionEntity[];
            // Capture existing tag names before any edits
            const existingNames = new Set<string>();
            for (const entity of sug) {
              for (const tag of entity.tags) {
                if (tag.isExisting) existingNames.add(tag.tagName);
              }
            }
            existingTagNamesRef.current = existingNames;
            setSuggestions(sug);
            setSelections(initSelections(sug));
          }

          // Surface batch errors so the UI can display them
          if (data.result?.errors?.length > 0) {
            setError(data.result.errors.join("; "));
          }
          // Stop polling
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        } else if (state === "failed") {
          setStatus("failed");
          setError(data.failedReason || "Job failed");
          if (persistKey) clearPersistedJobId(persistKey);
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
        console.error("Auto-tag poll error:", err);
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
  }, [jobId, status, persistKey]);

  // ── Toggle tag selection ────────────────────────────────────────────────

  const toggleTag = useCallback(
    (entityId: number, tagName: string) => {
      setSelections((prev) => {
        const next = new Map(prev);
        const entitySet = new Set(next.get(entityId) ?? []);
        if (entitySet.has(tagName)) {
          entitySet.delete(tagName);
        } else {
          entitySet.add(tagName);
        }
        next.set(entityId, entitySet);
        return next;
      });
    },
    [],
  );

  // ── Edit tag name ───────────────────────────────────────────────────────

  const editTag = useCallback(
    (entityId: number, oldName: string, newName: string) => {
      // Update selections: swap oldName for newName
      setSelections((prev) => {
        const next = new Map(prev);
        const entitySet = new Set(next.get(entityId) ?? []);
        if (entitySet.has(oldName)) {
          entitySet.delete(oldName);
          entitySet.add(newName);
        }
        next.set(entityId, entitySet);
        return next;
      });

      // Track the edit
      setEdits((prev) => {
        const next = new Map(prev);
        next.set(oldName, newName);
        return next;
      });

      // Update suggestions state so UI reflects the edit
      const matchesExisting = existingTagNamesRef.current.has(newName);
      setSuggestions((prev) => {
        if (!prev) return prev;
        return prev.map((entity) => {
          if (entity.entityId !== entityId) return entity;
          return {
            ...entity,
            tags: entity.tags.map((t) =>
              t.tagName === oldName
                ? {
                    ...t,
                    tagName: newName,
                    isExisting: matchesExisting,
                    matchedExistingTag: matchesExisting ? newName : undefined,
                  }
                : t,
            ),
          };
        });
      });
    },
    [],
  );

  // ── Apply accepted tags ─────────────────────────────────────────────────

  const apply = useCallback(async () => {
    if (!suggestions) return;

    setIsApplying(true);

    try {
      const payload: Array<{
        entityId: number;
        entityType: EntityType;
        tagName: string;
      }> = [];

      for (const entity of suggestions) {
        const accepted = selections.get(entity.entityId);
        if (!accepted) continue;

        for (const tagName of accepted) {
          // Check if this tag was edited (reverse lookup from edits map)
          const finalName = edits.get(tagName) ?? tagName;
          // If the edit map points to the current name, use it as-is
          // (edits are already applied in suggestions state via editTag)
          payload.push({
            entityId: entity.entityId,
            entityType: entity.entityType,
            tagName: finalName,
          });
        }
      }

      if (payload.length === 0) {
        setIsApplying(false);
        return;
      }

      const res = await fetch("/api/auto-tag/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestions: payload }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Apply failed (${res.status})`);
      }

      setIsApplying(false);
    } catch (err: any) {
      setIsApplying(false);
      throw err; // Let caller handle error display
    }
  }, [suggestions, selections, edits]);

  // ── Cancel ──────────────────────────────────────────────────────────────

  const cancel = useCallback(async () => {
    // Abort in-flight submit request if still pending
    if (submitAbortRef.current) {
      submitAbortRef.current.abort();
      submitAbortRef.current = null;
    }

    // Use persisted jobId as fallback if state hasn't been set yet (race with submit)
    const effectiveJobId = jobId ?? (persistKey ? getPersistedJobId(persistKey) : null);
    if (effectiveJobId) {
      try {
        await fetch(`/api/auto-tag/cancel/${effectiveJobId}`, { method: "POST" });
      } catch {
        // Best effort -- cancel may fail if job already completed
      }
    }

    // Stop polling
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (persistKey) clearPersistedJobId(persistKey);

    setJobId(null);
    setStatus("idle");
    setProgress(null);
    setSuggestions(null);
    setSelections(new Map());
    setEdits(new Map());
    setError(null);
    setIsApplying(false);
    setIsSubmitting(false);
  }, [jobId, persistKey]);

  // ── Reset ───────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (persistKey) clearPersistedJobId(persistKey);

    setJobId(null);
    setStatus("idle");
    setProgress(null);
    setSuggestions(null);
    setSelections(new Map());
    setEdits(new Map());
    setError(null);
    setIsApplying(false);
    setIsSubmitting(false);
  }, [persistKey]);

  // ── Summary (computed) ──────────────────────────────────────────────────

  const summary = useMemo(() => {
    if (!suggestions) return { assignCount: 0, newCount: 0 };

    let assignCount = 0;
    const newTagNames = new Set<string>();

    for (const entity of suggestions) {
      const accepted = selections.get(entity.entityId);
      if (!accepted) continue;

      for (const tag of entity.tags) {
        if (!accepted.has(tag.tagName)) continue;
        assignCount++;
        if (!tag.isExisting) {
          newTagNames.add(tag.tagName);
        }
      }
    }

    return { assignCount, newCount: newTagNames.size };
  }, [suggestions, selections]);

  return useMemo(
    () => ({
      jobId,
      status,
      progress,
      error,
      suggestions,
      selections,
      edits,
      submit,
      toggleTag,
      editTag,
      apply,
      cancel,
      reset,
      summary,
      isApplying,
      isSubmitting,
    }),
    [
      jobId,
      status,
      progress,
      error,
      suggestions,
      selections,
      edits,
      submit,
      toggleTag,
      editTag,
      apply,
      cancel,
      reset,
      summary,
      isApplying,
      isSubmitting,
    ],
  );
}
