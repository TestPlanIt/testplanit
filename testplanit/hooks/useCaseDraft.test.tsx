import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpsert, mockDeleteMany, mockUseFindFirst } = vi.hoisted(() => ({
  mockUpsert: vi.fn(),
  mockDeleteMany: vi.fn(),
  mockUseFindFirst: vi.fn(),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    caseDraft: {
      useUpsert: () => ({ mutateAsync: mockUpsert }),
      useDeleteMany: () => ({ mutateAsync: mockDeleteMany }),
      useFindFirst: mockUseFindFirst,
    },
  }),
}));

vi.mock("~/zenstack/schema", () => ({ schema: {} }));

import {
  buildCaseDraftPayload,
  caseDraftDigest,
  caseDraftStorageKey,
  readLocalCaseDraft,
  writeLocalCaseDraft,
} from "~/lib/services/caseDraft";
import {
  useCaseDraft,
  type UseCaseDraftOptions,
  type UseCaseDraftResult,
} from "./useCaseDraft";

const USER_ID = "user-1";
const CASE_ID = 7;
const STORAGE_KEY = caseDraftStorageKey(USER_ID, `case:${CASE_ID}`);

const BASELINE_VALUES = { name: "Login works" };
const BASELINE = caseDraftDigest(BASELINE_VALUES, {});

/**
 * Rendered over a real form with a real registered input, so edits travel the
 * same DOM-event path the editors use. That matters: the hook tells a user
 * edit from a programmatic write by whether react-hook-form reports an event
 * `type`, and `setValue`/`reset` look programmatic.
 */
let api: { form: ReturnType<typeof useForm<any>>; draft: UseCaseDraftResult };

function Harness(props: { overrides: Partial<UseCaseDraftOptions> }) {
  const form = useForm<any>({ defaultValues: { ...BASELINE_VALUES } });
  const draft = useCaseDraft({
    form,
    scope: { kind: "case", caseId: CASE_ID },
    projectId: 1,
    userId: USER_ID,
    enabled: true,
    extras: {},
    baselineDigest: BASELINE,
    ...props.overrides,
  });
  // Published from an effect, not during render: assigning to a variable
  // declared outside the component mid-render trips `react-hooks/globals`.
  useEffect(() => {
    api = { form, draft };
  });
  return <input data-testid="name-input" {...form.register("name")} />;
}

/** The prefix ZenStack keys this model's React Query entries under. */
const CASE_DRAFT_QUERY_KEY = ["zenstack", "CaseDraft", "findFirst", {}];

let queryClient: QueryClient;

function renderCaseDraft(overrides: Partial<UseCaseDraftOptions> = {}) {
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness overrides={overrides} />
    </QueryClientProvider>
  );
}

/** A real user edit: fires the DOM event react-hook-form reports a type for. */
function typeName(value: string) {
  act(() => {
    fireEvent.change(screen.getByTestId("name-input"), { target: { value } });
  });
}

/**
 * Settles pending promises and the re-renders they cause. `waitFor` cannot be
 * used here: it polls on real timers, which the fake timers below have
 * replaced, so it never resolves.
 */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  window.localStorage.clear();
  mockUpsert.mockReset().mockResolvedValue({});
  mockDeleteMany.mockReset().mockResolvedValue({ count: 1 });
  mockUseFindFirst.mockReset().mockReturnValue({ data: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCaseDraft auto-save", () => {
  it("mirrors a change to localStorage before any network write", () => {
    renderCaseDraft();

    typeName("Login works twice");

    // The whole point of the local mirror: it is already durable at the
    // instant the user types, with no debounce in front of it.
    expect(readLocalCaseDraft(STORAGE_KEY)?.values.name).toBe(
      "Login works twice"
    );
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(api.draft.status).toBe("dirty");
  });

  it("does not save on every keystroke", async () => {
    renderCaseDraft();

    typeName("a");
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    typeName("ab");
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(mockUpsert).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(2_500);
    });

    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it("saves once the user stops typing", async () => {
    renderCaseDraft();

    typeName("Login works twice");
    await act(async () => {
      vi.advanceTimersByTime(2_500);
    });

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const args = mockUpsert.mock.calls[0][0];
    expect(args.where).toEqual({
      userId_draftKey: { userId: USER_ID, draftKey: `case:${CASE_ID}` },
    });
    expect(args.create.payload.values.name).toBe("Login works twice");
    await flush();
    expect(api.draft.status).toBe("saved");
  });

  it("connects relations rather than setting their foreign keys", async () => {
    // The RPC layer validates against the checked create input, which has no
    // projectId/userId/caseId/folderId properties and rejects them outright
    // (422) — even though the ORM accepts the unchecked scalar form in-process.
    renderCaseDraft();

    typeName("Login works twice");
    await act(async () => {
      vi.advanceTimersByTime(2_500);
    });

    const create = mockUpsert.mock.calls[0][0].create;
    expect(create.project).toEqual({ connect: { id: 1 } });
    expect(create.user).toEqual({ connect: { id: USER_ID } });
    expect(create.case).toEqual({ connect: { id: CASE_ID } });
    expect(create).not.toHaveProperty("projectId");
    expect(create).not.toHaveProperty("userId");
    expect(create).not.toHaveProperty("caseId");
    expect(create).not.toHaveProperty("folderId");
  });

  it("connects the folder for a new-case draft", async () => {
    renderCaseDraft({ scope: { kind: "folder", folderId: 42 } });

    typeName("A brand new case");
    await act(async () => {
      vi.advanceTimersByTime(2_500);
    });

    const create = mockUpsert.mock.calls[0][0].create;
    expect(create.folder).toEqual({ connect: { id: 42 } });
    expect(create).not.toHaveProperty("case");
  });

  it("sends a payload with no undefined anywhere in it", async () => {
    // The Json column's validator rejects `undefined` at any depth, and
    // react-hook-form leaves it all over its values — an unset optional field,
    // a step row's absent sharedStepGroupName.
    renderCaseDraft();

    act(() => {
      api.form.setValue("steps", [
        { step: { type: "doc" }, sharedStepGroupName: undefined },
      ]);
    });
    typeName("With steps");
    await act(async () => {
      vi.advanceTimersByTime(2_500);
    });

    const payload = mockUpsert.mock.calls[0][0].create.payload;
    const hasUndefined = (v: unknown): boolean => {
      if (v === undefined) return true;
      if (Array.isArray(v)) return v.some(hasUndefined);
      if (v && typeof v === "object")
        return Object.values(v as Record<string, unknown>).some(hasUndefined);
      return false;
    };
    expect(hasUndefined(payload)).toBe(false);
  });

  it("saves during continuous typing without waiting for a pause", async () => {
    renderCaseDraft();

    // Type past the max-wait ceiling, never idling long enough for the
    // debounce to fire on its own.
    for (let i = 0; i < 20; i++) {
      typeName(`Login works ${i}`);
      await act(async () => {
        vi.advanceTimersByTime(2_000);
      });
    }

    expect(mockUpsert).toHaveBeenCalled();
  });

  it("goes quiet when the user undoes their way back to the original", async () => {
    renderCaseDraft();

    typeName("Login works twice");
    typeName(BASELINE_VALUES.name);
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(api.draft.isDirty).toBe(false);
  });

  it("stays idle while the baseline is unknown", async () => {
    renderCaseDraft({ baselineDigest: null });

    typeName("typed before the form settled");
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(readLocalCaseDraft(STORAGE_KEY)).toBeNull();
  });

  it("does nothing at all when disabled", async () => {
    renderCaseDraft({ enabled: false });

    typeName("not in edit mode");
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("retries after a failure and keeps the local copy meanwhile", async () => {
    mockUpsert.mockRejectedValueOnce(new Error("offline"));
    renderCaseDraft();

    typeName("Written while offline");
    await act(async () => {
      vi.advanceTimersByTime(2_500);
    });

    await flush();
    expect(api.draft.status).toBe("error");
    expect(readLocalCaseDraft(STORAGE_KEY)?.values.name).toBe(
      "Written while offline"
    );

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(mockUpsert).toHaveBeenCalledTimes(2);
    await flush();
    expect(api.draft.status).toBe("saved");
  });
});

describe("useCaseDraft settling", () => {
  it("treats a programmatic write as the form settling, not an edit", async () => {
    // Both editors reset the form from effects that re-run on background
    // refetches and template switches, and the values do not read back
    // identical to the object handed to reset() — StepsForm re-maps every step
    // row. Counting those as edits auto-saved a draft nobody typed, then
    // offered to restore it on the next visit.
    renderCaseDraft();

    act(() => {
      api.form.reset({ name: "Reshaped by the host's reset effect" });
    });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(readLocalCaseDraft(STORAGE_KEY)).toBeNull();
    expect(api.draft.isDirty).toBe(false);
  });

  it("measures dirtiness against the settled values, not the caller's baseline", async () => {
    renderCaseDraft();

    act(() => {
      api.form.reset({ name: "Settled shape" });
    });
    typeName("edited");
    typeName("Settled shape");
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(api.draft.isDirty).toBe(false);
  });

  it("stops re-anchoring once the user has typed", async () => {
    renderCaseDraft();

    typeName("A real edit");
    // A late reset now counts as a change rather than a new baseline — this is
    // the path a restore takes.
    act(() => {
      api.form.reset({ name: "Restored content" });
    });
    await act(async () => {
      vi.advanceTimersByTime(2_500);
    });

    expect(mockUpsert).toHaveBeenCalled();
    const calls = mockUpsert.mock.calls;
    expect(calls[calls.length - 1][0].create.payload.values.name).toBe(
      "Restored content"
    );
  });

  it("does not start a draft from an extras change alone", async () => {
    // Extras arrive as re-renders from the host, and this hook's effects run
    // before the host's own reset effect — so an extras change can be observed
    // against the previous commit's baseline. Only real edits start a draft.
    const { rerender } = renderCaseDraft({ extras: { tags: [1] } });

    rerender(
      <QueryClientProvider client={queryClient}>
        <Harness overrides={{ extras: { tags: [1, 2] } }} />
      </QueryClientProvider>
    );
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(api.draft.isDirty).toBe(false);
  });

  it("includes extras in the draft once the user has edited", async () => {
    const { rerender } = renderCaseDraft({ extras: { tags: [1] } });

    typeName("Edited first");
    rerender(
      <QueryClientProvider client={queryClient}>
        <Harness overrides={{ extras: { tags: [1, 2] } }} />
      </QueryClientProvider>
    );
    await act(async () => {
      vi.advanceTimersByTime(2_500);
    });

    const calls = mockUpsert.mock.calls;
    expect(calls[calls.length - 1][0].create.payload.extras).toEqual({
      tags: [1, 2],
    });
  });
});

describe("useCaseDraft restore", () => {
  it("offers a local draft that differs from what the editor shows", async () => {
    writeLocalCaseDraft(
      STORAGE_KEY,
      buildCaseDraftPayload({ name: "Half-written" })
    );

    renderCaseDraft();

    await flush();
    expect(api.draft.pendingRestore?.values.name).toBe("Half-written");
  });

  it("stays silent when the draft matches what the editor already shows", async () => {
    writeLocalCaseDraft(
      STORAGE_KEY,
      buildCaseDraftPayload({ ...BASELINE_VALUES })
    );

    renderCaseDraft();

    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(api.draft.pendingRestore).toBeNull();
  });

  it("prefers the newer of the server row and the local mirror", async () => {
    writeLocalCaseDraft(
      STORAGE_KEY,
      buildCaseDraftPayload(
        { name: "Older local" },
        {},
        new Date("2026-03-04T05:00:00Z")
      )
    );
    mockUseFindFirst.mockReturnValue({
      data: {
        payload: buildCaseDraftPayload(
          { name: "Newer server" },
          {},
          new Date("2026-03-04T06:00:00Z")
        ),
        baseVersion: 3,
      },
    });

    renderCaseDraft();

    await flush();
    expect(api.draft.pendingRestore?.values.name).toBe("Newer server");
  });

  it("keeps the local mirror when it is the newer of the two", async () => {
    writeLocalCaseDraft(
      STORAGE_KEY,
      buildCaseDraftPayload(
        { name: "Newer local" },
        {},
        new Date("2026-03-04T07:00:00Z")
      )
    );
    mockUseFindFirst.mockReturnValue({
      data: {
        payload: buildCaseDraftPayload(
          { name: "Older server" },
          {},
          new Date("2026-03-04T06:00:00Z")
        ),
        baseVersion: 3,
      },
    });

    renderCaseDraft();

    await flush();
    expect(api.draft.pendingRestore?.values.name).toBe("Newer local");
  });

  it("ignores a payload written by an older schema version", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 0, values: { name: "Ancient" } })
    );

    renderCaseDraft();

    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(api.draft.pendingRestore).toBeNull();
  });

  it("flags a server draft taken against an older case version", async () => {
    mockUseFindFirst.mockReturnValue({
      data: {
        payload: buildCaseDraftPayload({ name: "Written before their save" }),
        baseVersion: 2,
      },
    });

    renderCaseDraft({ baseVersion: 4 });

    await flush();
    expect(api.draft.isRestoreStale).toBe(true);
  });

  it("does not flag a draft taken against the current version", async () => {
    mockUseFindFirst.mockReturnValue({
      data: {
        payload: buildCaseDraftPayload({ name: "Still current" }),
        baseVersion: 4,
      },
    });

    renderCaseDraft({ baseVersion: 4 });

    await flush();
    expect(api.draft.pendingRestore).not.toBeNull();
    expect(api.draft.isRestoreStale).toBe(false);
  });

  it("hands back the payload on accept and stops offering it", async () => {
    writeLocalCaseDraft(
      STORAGE_KEY,
      buildCaseDraftPayload({ name: "Half-written" })
    );
    renderCaseDraft();
    await flush();
    expect(api.draft.pendingRestore).not.toBeNull();

    let accepted: unknown;
    act(() => {
      accepted = api.draft.acceptRestore();
    });

    expect((accepted as { values: { name: string } }).values.name).toBe(
      "Half-written"
    );
    expect(api.draft.pendingRestore).toBeNull();
    // Accepting keeps the draft: the restored edits are themselves unsaved.
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("keeps auto-saving the content a restore applied", async () => {
    // The caller applies a restore with reset(), which looks programmatic. If
    // that re-anchored the baseline, the recovered work would read as already
    // saved and never be written again.
    writeLocalCaseDraft(
      STORAGE_KEY,
      buildCaseDraftPayload({ name: "Half-written" })
    );
    renderCaseDraft();
    await flush();

    act(() => {
      api.draft.acceptRestore();
    });
    act(() => {
      api.form.reset({ name: "Half-written" });
    });
    await act(async () => {
      vi.advanceTimersByTime(2_500);
    });

    expect(mockUpsert).toHaveBeenCalled();
  });

  it("deletes both copies on discard", async () => {
    writeLocalCaseDraft(
      STORAGE_KEY,
      buildCaseDraftPayload({ name: "Half-written" })
    );
    renderCaseDraft();
    await flush();
    expect(api.draft.pendingRestore).not.toBeNull();

    act(() => {
      api.draft.discardRestore();
    });

    expect(readLocalCaseDraft(STORAGE_KEY)).toBeNull();
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, draftKey: `case:${CASE_ID}` },
    });
  });
});

describe("useCaseDraft clear", () => {
  it("removes both copies and cancels a pending save", async () => {
    renderCaseDraft();

    typeName("About to be saved for real");
    act(() => {
      api.draft.clear();
    });
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    // An explicit Save has just written these values to the case itself, so
    // the queued auto-save must not resurrect the draft behind it.
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(readLocalCaseDraft(STORAGE_KEY)).toBeNull();
    expect(mockDeleteMany).toHaveBeenCalled();
    expect(api.draft.isDirty).toBe(false);
  });

  it("evicts the cached read so the next open cannot replay a promoted draft", async () => {
    // The dialog unmounts the moment a case is created. The restore query is
    // deliberately never invalidated by the editor's own auto-saves, so
    // without this eviction the next open replays this session's cached row
    // and offers to restore the draft the user just promoted and saved.
    queryClient.setQueryData(CASE_DRAFT_QUERY_KEY, {
      payload: buildCaseDraftPayload({ name: "Already promoted" }),
    });
    renderCaseDraft();

    act(() => {
      api.draft.clear();
    });

    expect(queryClient.getQueryData(CASE_DRAFT_QUERY_KEY)).toBeNull();

    // Once the delete lands the entry goes entirely, so the next open reads
    // the server rather than trusting this session's optimistic null.
    await flush();
    expect(queryClient.getQueryState(CASE_DRAFT_QUERY_KEY)).toBeUndefined();
  });

  it("survives a delete that fails", async () => {
    mockDeleteMany.mockRejectedValue(new Error("offline"));
    renderCaseDraft();

    typeName("x");
    expect(() => act(() => api.draft.clear())).not.toThrow();
    expect(readLocalCaseDraft(STORAGE_KEY)).toBeNull();
  });
});

describe("useCaseDraft unload guard", () => {
  it("blocks unload only while there are unsaved changes", async () => {
    renderCaseDraft();

    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    typeName("Unsaved");

    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(2_500);
    });
    await flush();
    expect(api.draft.status).toBe("saved");

    const saved = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(saved);
    expect(saved.defaultPrevented).toBe(false);
  });
});
