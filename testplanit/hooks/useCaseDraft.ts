"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { schema } from "~/zenstack/schema";
import {
  buildCaseDraftPayload,
  CASE_DRAFT_DEBOUNCE_MS,
  CASE_DRAFT_MAX_WAIT_MS,
  CASE_DRAFT_RETRY_DELAYS_MS,
  caseDraftDigest,
  caseDraftKey,
  caseDraftStorageKey,
  clearLocalCaseDraft,
  isCaseDraftPayload,
  newerCaseDraft,
  readLocalCaseDraft,
  toCaseDraftColumn,
  writeLocalCaseDraft,
  type CaseDraftExtras,
  type CaseDraftPayload,
  type CaseDraftScope,
} from "~/lib/services/caseDraft";

/**
 * Prefix of every React Query entry ZenStack keeps for this model. Keys are
 * `["zenstack", <Model>, <operation>, args]`, so this matches all of them.
 */
const CASE_DRAFT_QUERY_KEY = ["zenstack", "CaseDraft"] as const;

export type CaseDraftStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export interface UseCaseDraftOptions {
  /** The editor's react-hook-form instance. */
  form: UseFormReturn<any>;
  /** `null` while the editor does not yet know what it is editing. */
  scope: CaseDraftScope | null;
  projectId: number;
  userId: string | undefined;
  /** True only while the editor is actually open / in edit mode. */
  enabled: boolean;
  /**
   * Look for an existing draft even when auto-save is off. The case page uses
   * this to offer a recovery banner in read mode — after a crash that is where
   * the user lands, and they would otherwise see the saved content and assume
   * their work is gone.
   */
  detectWhenDisabled?: boolean;
  /** Editor state the form does not own (tags, issues, inline parameters). */
  extras?: CaseDraftExtras;
  /**
   * Digest of the values the editor was opened with, from `caseDraftDigest`.
   * Anything equal to it is not unsaved work. `null` until the caller's own
   * `reset()` has run, which also suppresses auto-save until the form settles.
   */
  baselineDigest: string | null;
  /** The case's `currentVersion` at open; `null` for a new case. */
  baseVersion?: number | null;
}

export interface UseCaseDraftResult {
  status: CaseDraftStatus;
  lastSavedAt: Date | null;
  isDirty: boolean;
  /** A draft found at open that the user has neither restored nor discarded. */
  pendingRestore: CaseDraftPayload | null;
  /** True when the pending draft was written against an older case version. */
  isRestoreStale: boolean;
  /** Marks the prompt answered and hands back the payload to apply. */
  acceptRestore: () => CaseDraftPayload | null;
  /** Marks the prompt answered and deletes both copies. */
  discardRestore: () => void;
  /** Deletes both copies. Call after an explicit Save, and on Cancel. */
  clear: () => void;
}

/**
 * Auto-saves an in-progress case edit to localStorage immediately and to the
 * `CaseDraft` table on a debounce, and surfaces any draft found at open so the
 * editor can offer to restore it.
 *
 * The hook subscribes to the form rather than reading `watch()` values through
 * a render: `watch()` with no argument re-renders its host on every keystroke,
 * and both hosts here are large. Only status transitions re-render.
 */
export function useCaseDraft({
  form,
  scope,
  projectId,
  userId,
  enabled,
  detectWhenDisabled = false,
  extras,
  baselineDigest,
  baseVersion,
}: UseCaseDraftOptions): UseCaseDraftResult {
  const draftKey = scope ? caseDraftKey(scope) : null;
  const storageKey =
    userId && draftKey ? caseDraftStorageKey(userId, draftKey) : null;
  const active = enabled && !!userId && !!draftKey && !!baselineDigest;
  // Auto-save needs the editor open; finding an existing draft does not.
  const detecting = enabled || detectWhenDisabled;

  const queryClient = useQueryClient();

  const [status, setStatus] = useState<CaseDraftStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<CaseDraftPayload | null>(
    null
  );
  const [restoreBaseVersion, setRestoreBaseVersion] = useState<number | null>(
    null
  );

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const inFlightRef = useRef(false);
  const rerunAfterFlightRef = useRef(false);
  const latestPayloadRef = useRef<CaseDraftPayload | null>(null);
  const restoreResolvedRef = useRef(false);
  /** What the form actually reports once it has settled — see `onChange`. */
  const settledBaselineRef = useRef<string | null>(null);
  /** Flips on the first real user edit; until then the baseline re-anchors. */
  const userEditedRef = useRef(false);

  // Read from callbacks and timers that must not re-subscribe when these
  // change. Synced from an effect rather than during render — writing a ref
  // mid-render is what `react-hooks/refs` forbids — and declared ahead of
  // every effect that reads them, since effects run in declaration order.
  const extrasRef = useRef<CaseDraftExtras | undefined>(extras);
  const baselineRef = useRef<string | null>(baselineDigest);
  const baseVersionRef = useRef<number | null | undefined>(baseVersion);
  useEffect(() => {
    extrasRef.current = extras;
    baselineRef.current = baselineDigest;
    baseVersionRef.current = baseVersion;
  }, [baseVersion, baselineDigest, extras]);

  // `invalidateQueries: false` on both: nothing in the app renders a list of
  // drafts, and invalidating would refetch the restore query below on every
  // keystroke burst — which would make the restore prompt reappear mid-edit.
  const { mutateAsync: upsertCaseDraft } = useClientQueries(
    schema
  ).caseDraft.useUpsert({ invalidateQueries: false });
  const { mutateAsync: deleteCaseDraft } = useClientQueries(
    schema
  ).caseDraft.useDeleteMany({ invalidateQueries: false });

  // One read per editing session. It must not refetch *during* a session — the
  // editor's own auto-saves would otherwise bring the prompt back mid-edit —
  // but it must not be replayed from cache into the *next* session either, or
  // a draft that has since been promoted and deleted gets offered again.
  // `clear()` evicts the entry, and `refetchOnMount` re-reads on the next open.
  const { data: serverDraft } = useClientQueries(schema).caseDraft.useFindFirst(
    {
      where: { userId: userId ?? "", draftKey: draftKey ?? "" },
    },
    {
      enabled: detecting && !!userId && !!draftKey,
      staleTime: Infinity,
      refetchOnMount: "always",
      refetchOnWindowFocus: false,
    }
  );

  const clearTimers = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current);
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    idleTimerRef.current = null;
    maxWaitTimerRef.current = null;
    retryTimerRef.current = null;
  }, []);

  const flush = useCallback(async () => {
    if (!userId || !draftKey || !scope) return;
    const payload = latestPayloadRef.current;
    if (!payload) return;
    if (inFlightRef.current) {
      rerunAfterFlightRef.current = true;
      return;
    }

    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (maxWaitTimerRef.current) clearTimeout(maxWaitTimerRef.current);
    idleTimerRef.current = null;
    maxWaitTimerRef.current = null;

    inFlightRef.current = true;
    setStatus("saving");

    // Relations are connected, not set through their scalar foreign keys. The
    // RPC layer validates against the *checked* create input, which has no
    // `projectId`/`userId`/`caseId`/`folderId` properties at all and rejects
    // them as unrecognized keys — even though the ORM itself accepts the
    // unchecked scalar form when called in-process.
    const scopeConnect =
      scope.kind === "case"
        ? { case: { connect: { id: scope.caseId } } }
        : { folder: { connect: { id: scope.folderId } } };

    try {
      await upsertCaseDraft({
        where: { userId_draftKey: { userId, draftKey } },
        create: {
          draftKey,
          project: { connect: { id: projectId } },
          user: { connect: { id: userId } },
          ...scopeConnect,
          payload: toCaseDraftColumn(payload),
          baseVersion: baseVersionRef.current ?? null,
        },
        update: {
          payload: toCaseDraftColumn(payload),
          baseVersion: baseVersionRef.current ?? null,
        },
      });
      retryAttemptRef.current = 0;
      setLastSavedAt(new Date(payload.savedAt));
      setStatus("saved");
      setIsDirty(false);
    } catch {
      // The localStorage mirror already holds this payload, so the work is not
      // lost while the server is unreachable — retry with backoff.
      setStatus("error");
      const delay =
        CASE_DRAFT_RETRY_DELAYS_MS[
          Math.min(
            retryAttemptRef.current,
            CASE_DRAFT_RETRY_DELAYS_MS.length - 1
          )
        ];
      retryAttemptRef.current += 1;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        void flush();
      }, delay);
    } finally {
      inFlightRef.current = false;
      if (rerunAfterFlightRef.current) {
        rerunAfterFlightRef.current = false;
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        idleTimerRef.current = setTimeout(() => {
          void flush();
        }, CASE_DRAFT_DEBOUNCE_MS);
      }
    }
  }, [draftKey, projectId, scope, upsertCaseDraft, userId]);

  /**
   * Called on every form or extras change while active. `isUserEdit` is false
   * for programmatic writes — `reset()`, `setValue()`, a `useFieldArray`
   * replace — which re-anchor the baseline instead of marking the form dirty.
   *
   * This exists because the caller's baseline is computed from the
   * `defaultValues` object it hands to `reset()`, and the form does not read
   * back identical to it: StepsForm owns the steps field array and re-maps
   * every row into its own shape on mount. Comparing against the caller's
   * object alone left the editor permanently "dirty" the instant edit mode
   * opened, which auto-saved a draft nobody had typed and then offered to
   * restore it on the next visit.
   */
  const onChange = useCallback(
    (values: Record<string, unknown>, isUserEdit: boolean) => {
      if (!baselineRef.current || !storageKey) return;

      const currentExtras = extrasRef.current ?? {};
      const digest = caseDraftDigest(values, currentExtras);

      // Still settling: adopt whatever the form reports as the true baseline.
      if (!isUserEdit && !userEditedRef.current) {
        settledBaselineRef.current = digest;
        clearTimers();
        latestPayloadRef.current = null;
        setIsDirty(false);
        return;
      }
      if (isUserEdit) userEditedRef.current = true;

      const baseline = settledBaselineRef.current ?? baselineRef.current;
      if (digest === baseline) {
        // Back to the state the editor opened with — there is nothing to save,
        // and a draft written earlier in this session no longer describes
        // unsaved work.
        clearTimers();
        latestPayloadRef.current = null;
        setIsDirty(false);
        setStatus((prev) => (prev === "saved" ? "saved" : "idle"));
        return;
      }

      const payload = buildCaseDraftPayload(values, currentExtras);
      latestPayloadRef.current = payload;
      writeLocalCaseDraft(storageKey, payload);
      setIsDirty(true);
      setStatus((prev) => (prev === "saving" ? prev : "dirty"));

      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        void flush();
      }, CASE_DRAFT_DEBOUNCE_MS);

      // Ceiling for continuous typing: started on the first change after a
      // save and deliberately not reset by later ones.
      if (!maxWaitTimerRef.current) {
        maxWaitTimerRef.current = setTimeout(() => {
          void flush();
        }, CASE_DRAFT_MAX_WAIT_MS);
      }
    },
    [clearTimers, flush, storageKey]
  );

  // Form subscription. react-hook-form reports `type` only for changes that
  // came from a real input event, so an absent `type` means the write was
  // programmatic — a reset, a setValue, or a field-array replace.
  useEffect(() => {
    if (!active) return;
    const subscription = form.watch((values, info) => {
      onChange((values ?? {}) as Record<string, unknown>, !!info?.type);
    });
    return () => subscription.unsubscribe();
  }, [active, form, onChange]);

  // Extras are React state, so they arrive as re-renders rather than through
  // the form subscription.
  const extrasDigest = useMemo(
    () => caseDraftDigest({}, extras ?? {}),
    [extras]
  );
  const seenExtrasDigestRef = useRef<string | null>(null);
  useEffect(() => {
    if (!active) {
      seenExtrasDigestRef.current = null;
      return;
    }
    if (seenExtrasDigestRef.current === extrasDigest) return;
    seenExtrasDigestRef.current = extrasDigest;
    // Never treated as the edit that starts a draft. This hook's effects are
    // declared before the host's own reset effect, so on the render where a
    // value like `selectedTemplateId` finally resolves, this fires while
    // `baselineDigest` still holds the previous commit's value — which looked
    // exactly like the user having changed the template. Once a real edit has
    // happened, `onChange` routes extras through the normal dirty path, so a
    // tag or issue change still auto-saves alongside typed content.
    onChange(form.getValues() as Record<string, unknown>, false);
  }, [active, extrasDigest, form, onChange]);

  // Surface a draft found at open: the later of the server row and the local
  // mirror, unless it merely repeats the state the editor already shows.
  useEffect(() => {
    if (!detecting || !storageKey || !baselineDigest) return;
    if (restoreResolvedRef.current) return;
    // Wait for the server read to settle so the local copy cannot win by
    // default and lose a newer draft written on another machine.
    if (serverDraft === undefined) return;

    const local = readLocalCaseDraft(storageKey);
    const remote = isCaseDraftPayload(serverDraft?.payload)
      ? (serverDraft.payload as CaseDraftPayload)
      : null;
    const winner = newerCaseDraft(local, remote);

    restoreResolvedRef.current = true;
    if (!winner) return;
    const baseline = settledBaselineRef.current ?? baselineDigest;
    if (caseDraftDigest(winner.values, winner.extras) === baseline) {
      // The draft matches what the editor already shows — nothing to restore.
      return;
    }
    setPendingRestore(winner);
    setRestoreBaseVersion(
      winner === remote ? (serverDraft?.baseVersion ?? null) : null
    );
  }, [baselineDigest, detecting, serverDraft, storageKey]);

  const clear = useCallback(() => {
    clearTimers();
    latestPayloadRef.current = null;
    retryAttemptRef.current = 0;
    rerunAfterFlightRef.current = false;
    setIsDirty(false);
    setStatus("idle");
    setLastSavedAt(null);
    setPendingRestore(null);
    if (storageKey) clearLocalCaseDraft(storageKey);
    // Drop the cached read straight away, before the delete round-trips. The
    // dialog unmounts the instant a case is created, and reopening it mounts a
    // fresh hook that would otherwise be handed this session's cached row and
    // offer to restore the draft the user just promoted.
    queryClient.setQueriesData({ queryKey: CASE_DRAFT_QUERY_KEY }, null);
    if (userId && draftKey) {
      // deleteMany, not delete: a draft that was never synced to the server has
      // no row, and `delete` on a missing row throws.
      void deleteCaseDraft({ where: { userId, draftKey } })
        .then(() => {
          // Evict rather than leave the null above cached, so the next open
          // reads the server rather than trusting this session's guess.
          queryClient.removeQueries({ queryKey: CASE_DRAFT_QUERY_KEY });
        })
        .catch(() => {
          // A stranded row is harmless — the retention job sweeps it, and the
          // restore prompt filters drafts that match the current editor state.
        });
    }
  }, [clearTimers, deleteCaseDraft, draftKey, queryClient, storageKey, userId]);

  const acceptRestore = useCallback(() => {
    restoreResolvedRef.current = true;
    // The caller applies the draft with `reset()`, which the watch reports as
    // a programmatic write. Without this, that write would be mistaken for the
    // form still settling and re-anchor the baseline — leaving the restored
    // edits looking saved and never auto-saved again.
    userEditedRef.current = true;
    const payload = pendingRestore;
    setPendingRestore(null);
    return payload;
  }, [pendingRestore]);

  const discardRestore = useCallback(() => {
    restoreResolvedRef.current = true;
    clear();
  }, [clear]);

  // Reset per-editing-session state when the editor closes or the target
  // changes, so reopening re-runs the restore check against the new target.
  useEffect(() => {
    if (detecting) return;
    clearTimers();
    restoreResolvedRef.current = false;
    latestPayloadRef.current = null;
    retryAttemptRef.current = 0;
    settledBaselineRef.current = null;
    userEditedRef.current = false;
    setPendingRestore(null);
    setIsDirty(false);
    setStatus("idle");
    setLastSavedAt(null);
  }, [clearTimers, detecting, draftKey]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  // Secondary safety net. The localStorage mirror is already written, so this
  // exists to stop the user losing work they have not seen saved, not to buy
  // time for a request.
  useEffect(() => {
    if (!active || !isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers require a returnValue to show the prompt; the string
      // itself has been ignored by every browser for years.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active, isDirty]);

  const isRestoreStale =
    pendingRestore !== null &&
    restoreBaseVersion !== null &&
    baseVersion != null &&
    restoreBaseVersion < baseVersion;

  return {
    status,
    lastSavedAt,
    isDirty,
    pendingRestore,
    isRestoreStale,
    acceptRestore,
    discardRestore,
    clear,
  };
}
