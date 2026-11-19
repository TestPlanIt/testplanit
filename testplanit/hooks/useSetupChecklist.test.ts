import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const counts = vi.hoisted(() => ({
  projects: 0 as number | undefined,
  user: 0 as number | undefined,
  integration: 0 as number | undefined,
  llmIntegration: 0 as number | undefined,
  ssoProvider: 0 as number | undefined,
}));
const preferences = vi.hoisted(() => ({
  value: { id: "pref-1", hasDismissedSetupChecklist: false } as
    { id: string; hasDismissedSetupChecklist: boolean } | null | undefined,
}));
const markedConfig = vi.hoisted(() => ({
  value: null as { key: string; value: unknown } | null | undefined,
}));
const calls = vi.hoisted(() => ({ count: {} as Record<string, unknown> }));
const updatePreferences = vi.hoisted(() => vi.fn());
const upsertConfig = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "admin-1", access: "ADMIN" } } }),
}));
vi.mock("~/lib/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("@zenstackhq/tanstack-query/react", () => {
  const countHook = (model: keyof typeof counts) => ({
    useCount: (args: unknown) => {
      calls.count[model] = args;
      return { data: counts[model] };
    },
  });
  return {
    useClientQueries: () => ({
      projects: countHook("projects"),
      user: countHook("user"),
      integration: countHook("integration"),
      llmIntegration: countHook("llmIntegration"),
      ssoProvider: countHook("ssoProvider"),
      appConfig: {
        useFindUnique: () => ({ data: markedConfig.value }),
        useUpsert: () => ({ mutateAsync: upsertConfig }),
      },
      userPreferences: {
        useFindFirst: () => ({ data: preferences.value }),
        useUpdate: () => ({ mutateAsync: updatePreferences }),
      },
    }),
  };
});

import {
  buildSetupChecklistItems,
  parseMarkedItems,
  SETUP_CHECKLIST_MARKED_KEY,
  useSetupChecklist,
  useShowSetupChecklist,
} from "./useSetupChecklist";

const noCounts = {
  projects: 0,
  otherUsers: 0,
  issueTrackers: 0,
  aiProviders: 0,
  ssoProviders: 0,
};

describe("buildSetupChecklistItems", () => {
  it("marks an item done when the data it asks for exists", () => {
    const items = buildSetupChecklistItems({
      ...noCounts,
      projects: 2,
      issueTrackers: 1,
    });
    expect(items.map((item) => [item.key, item.done, item.detected])).toEqual([
      ["createProject", true, true],
      ["inviteTeam", false, false],
      ["connectIssueTracker", true, true],
      ["connectAiProvider", false, false],
      ["setUpSso", false, false],
    ]);
  });

  it("marks an item done when an admin ticked it", () => {
    const items = buildSetupChecklistItems(noCounts, ["setUpSso"]);
    const sso = items.find((item) => item.key === "setUpSso")!;
    expect(sso).toMatchObject({ done: true, marked: true, detected: false });
  });

  it("links every item but project creation to its admin page", () => {
    const items = buildSetupChecklistItems(noCounts);
    expect(
      Object.fromEntries(items.map((item) => [item.key, item.href]))
    ).toEqual({
      createProject: null,
      inviteTeam: "/admin/users",
      connectIssueTracker: "/admin/integrations",
      connectAiProvider: "/admin/llm",
      setUpSso: "/admin/sso",
    });
  });
});

describe("parseMarkedItems", () => {
  it("keeps known item keys and drops anything else", () => {
    expect(parseMarkedItems(["setUpSso", "bogus", 3, "inviteTeam"])).toEqual([
      "inviteTeam",
      "setUpSso",
    ]);
    expect(parseMarkedItems(null)).toEqual([]);
    expect(parseMarkedItems({ setUpSso: true })).toEqual([]);
  });
});

describe("useSetupChecklist", () => {
  beforeEach(() => {
    Object.assign(counts, {
      projects: 0,
      user: 0,
      integration: 0,
      llmIntegration: 0,
      ssoProvider: 0,
    });
    preferences.value = { id: "pref-1", hasDismissedSetupChecklist: false };
    markedConfig.value = null;
    updatePreferences.mockReset();
    upsertConfig.mockReset();
  });

  it("is visible to an admin while something is left to do", () => {
    counts.projects = 1;
    const { result } = renderHook(() => useSetupChecklist(true));
    expect(result.current.visible).toBe(true);
    expect(result.current.doneCount).toBe(1);
  });

  it("is hidden when not enabled for the viewer", () => {
    const { result } = renderHook(() => useSetupChecklist(false));
    expect(result.current.visible).toBe(false);
  });

  it("stays hidden until every count has loaded", () => {
    counts.ssoProvider = undefined;
    const { result } = renderHook(() => useSetupChecklist(true));
    expect(result.current.visible).toBe(false);
  });

  it("stays hidden until the ticked items have loaded", () => {
    markedConfig.value = undefined;
    const { result } = renderHook(() => useSetupChecklist(true));
    expect(result.current.visible).toBe(false);
  });

  it("counts ticked items as done", () => {
    markedConfig.value = {
      key: SETUP_CHECKLIST_MARKED_KEY,
      value: ["connectAiProvider", "setUpSso"],
    };
    const { result } = renderHook(() => useSetupChecklist(true));
    expect(result.current.doneCount).toBe(2);
  });

  it("is hidden once every item is done", () => {
    Object.assign(counts, {
      projects: 1,
      user: 1,
      integration: 1,
      llmIntegration: 1,
    });
    markedConfig.value = {
      key: SETUP_CHECKLIST_MARKED_KEY,
      value: ["setUpSso"],
    };
    const { result } = renderHook(() => useSetupChecklist(true));
    expect(result.current.doneCount).toBe(5);
    expect(result.current.visible).toBe(false);
  });

  it("stays visible when everything is done if asked to", () => {
    Object.assign(counts, {
      projects: 1,
      user: 1,
      integration: 1,
      llmIntegration: 1,
      ssoProvider: 1,
    });
    const { result } = renderHook(() =>
      useSetupChecklist(true, { forceVisible: true })
    );
    expect(result.current.visible).toBe(true);
  });

  it("is hidden after the admin dismissed it, even when asked to show", () => {
    preferences.value = { id: "pref-1", hasDismissedSetupChecklist: true };
    const { result } = renderHook(() =>
      useSetupChecklist(true, { forceVisible: true })
    );
    expect(result.current.visible).toBe(false);
  });

  it("dismisses by saving the preference", async () => {
    const { result } = renderHook(() => useSetupChecklist(true));
    await result.current.dismiss();
    expect(updatePreferences).toHaveBeenCalledWith({
      where: { id: "pref-1" },
      data: { hasDismissedSetupChecklist: true },
    });
  });

  it("saves ticks for every admin and shows them before the save returns", async () => {
    markedConfig.value = {
      key: SETUP_CHECKLIST_MARKED_KEY,
      value: ["inviteTeam"],
    };
    let finishSave = () => {};
    upsertConfig.mockImplementation(
      () => new Promise<void>((resolve) => (finishSave = resolve))
    );
    const { result } = renderHook(() => useSetupChecklist(true));

    let saving: Promise<void> = Promise.resolve();
    act(() => {
      saving = result.current.setMarked("setUpSso", true);
    });
    expect(result.current.doneCount).toBe(2);
    expect(upsertConfig).toHaveBeenCalledWith({
      where: { key: SETUP_CHECKLIST_MARKED_KEY },
      create: {
        key: SETUP_CHECKLIST_MARKED_KEY,
        value: ["inviteTeam", "setUpSso"],
      },
      update: { value: ["inviteTeam", "setUpSso"] },
    });

    await act(async () => {
      finishSave();
      await saving;
    });
  });

  it("takes a tick back", async () => {
    markedConfig.value = {
      key: SETUP_CHECKLIST_MARKED_KEY,
      value: ["inviteTeam", "setUpSso"],
    };
    upsertConfig.mockResolvedValue(undefined);
    const { result } = renderHook(() => useSetupChecklist(true));
    await act(() => result.current.setMarked("setUpSso", false));
    expect(upsertConfig).toHaveBeenCalledWith(
      expect.objectContaining({ update: { value: ["inviteTeam"] } })
    );
  });

  it("puts the ticks back when saving fails", async () => {
    upsertConfig.mockRejectedValue(new Error("denied"));
    const { result } = renderHook(() => useSetupChecklist(true));
    await act(async () => {
      await expect(result.current.setMarked("setUpSso", true)).rejects.toThrow(
        "denied"
      );
    });
    expect(result.current.doneCount).toBe(0);
  });

  it("does not count the Demo Project, the viewer, or magic link sign-in", () => {
    renderHook(() => useSetupChecklist(true));
    expect(calls.count.projects).toEqual({
      where: { isDeleted: false, isDemo: false },
    });
    expect(calls.count.user).toEqual({
      where: { isDeleted: false, isActive: true, id: { not: "admin-1" } },
    });
    expect(calls.count.ssoProvider).toEqual({
      where: { enabled: true, type: { not: "MAGIC_LINK" } },
    });
  });
});

describe("useShowSetupChecklist", () => {
  beforeEach(() => {
    updatePreferences.mockReset();
    push.mockReset();
  });

  it("undoes the admin's hide and opens the home page with the checklist", async () => {
    preferences.value = { id: "pref-1", hasDismissedSetupChecklist: true };
    const { result } = renderHook(() => useShowSetupChecklist());
    await result.current();
    expect(updatePreferences).toHaveBeenCalledWith({
      where: { id: "pref-1" },
      data: { hasDismissedSetupChecklist: false },
    });
    expect(push).toHaveBeenCalledWith("/?setupChecklist=open");
  });

  it("only navigates when the checklist was not hidden", async () => {
    preferences.value = { id: "pref-1", hasDismissedSetupChecklist: false };
    const { result } = renderHook(() => useShowSetupChecklist());
    await result.current();
    expect(updatePreferences).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/?setupChecklist=open");
  });
});
