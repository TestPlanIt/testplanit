"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { EntityType } from "~/lib/llm/services/auto-tag/types";
import type {
  AutoTagSuggestionEntity,
  AutoTagSelection,
  AutoTagJobState,
  UseAutoTagJobReturn,
} from "./types";

const POLL_INTERVAL_MS = 2000;

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

export function useAutoTagJob(): UseAutoTagJobReturn {
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<AutoTagJobState>("idle");
  const [progress, setProgress] = useState<{
    analyzed: number;
    total: number;
  } | null>(null);
  const [suggestions, setSuggestions] = useState<
    AutoTagSuggestionEntity[] | null
  >(null);
  const [selections, setSelections] = useState<AutoTagSelection>(new Map());
  const [edits, setEdits] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Track polling interval for cleanup
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Submit ──────────────────────────────────────────────────────────────

  const submit = useCallback(
    async (
      entityIds: number[],
      entityType: EntityType,
      projectId: number,
    ) => {
      setIsSubmitting(true);
      setStatus("waiting");
      setError(null);
      setSuggestions(null);
      setSelections(new Map());
      setEdits(new Map());
      setProgress(null);

      try {
        const res = await fetch("/api/auto-tag/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityIds, entityType, projectId }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Submit failed (${res.status})`);
        }

        const data = await res.json();
        setJobId(data.jobId);
      } catch (err: any) {
        setError(err.message || "Failed to submit auto-tag job");
        setStatus("failed");
      } finally {
        setIsSubmitting(false);
      }
    },
    [],
  );

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

        // Update progress
        if (data.progress) {
          setProgress(data.progress);
        }

        // Map BullMQ state to our state type
        const state = data.state as string;
        if (state === "completed") {
          setStatus("completed");
          if (data.result?.suggestions) {
            const sug = data.result.suggestions as AutoTagSuggestionEntity[];
            setSuggestions(sug);
            setSelections(initSelections(sug));
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
  }, [jobId, status]);

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
      setSuggestions((prev) => {
        if (!prev) return prev;
        return prev.map((entity) => {
          if (entity.entityId !== entityId) return entity;
          return {
            ...entity,
            tags: entity.tags.map((t) =>
              t.tagName === oldName ? { ...t, tagName: newName } : t,
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
    if (jobId) {
      try {
        await fetch(`/api/auto-tag/cancel/${jobId}`, { method: "POST" });
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
    setSuggestions(null);
    setSelections(new Map());
    setEdits(new Map());
    setError(null);
    setIsApplying(false);
    setIsSubmitting(false);
  }, [jobId]);

  // ── Reset ───────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    setJobId(null);
    setStatus("idle");
    setProgress(null);
    setSuggestions(null);
    setSelections(new Map());
    setEdits(new Map());
    setError(null);
    setIsApplying(false);
    setIsSubmitting(false);
  }, []);

  // ── Summary (computed) ──────────────────────────────────────────────────

  const summary = useMemo(() => {
    if (!suggestions) return { existingCount: 0, newCount: 0 };

    let existingCount = 0;
    let newCount = 0;

    for (const entity of suggestions) {
      const accepted = selections.get(entity.entityId);
      if (!accepted) continue;

      for (const tag of entity.tags) {
        if (!accepted.has(tag.tagName)) continue;

        if (tag.isExisting) {
          existingCount++;
        } else {
          newCount++;
        }
      }
    }

    return { existingCount, newCount };
  }, [suggestions, selections]);

  return {
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
  };
}
