import { describe, expect, it, vi } from "vitest";

import {
  assertResultEditWindowOpen,
  EditWindowExpiredError,
  isEditWindowExpiredError,
  readEditResultsDurationSeconds,
  resolveEffectiveWindowSeconds,
} from "./editWindow";

function makeClient(opts: {
  systemDuration?: unknown; // AppConfig row value; undefined => no row
  executedAt?: Date | null; // result executedAt; null => no result row
  projectSeconds?: number | null; // Projects.editResultsDurationSeconds
}) {
  const appConfig = {
    findUnique: vi
      .fn()
      .mockResolvedValue(
        opts.systemDuration === undefined
          ? null
          : { key: "edit_results_duration", value: opts.systemDuration }
      ),
  };
  const testRunResults = {
    findUnique: vi.fn().mockResolvedValue(
      opts.executedAt === undefined || opts.executedAt === null
        ? null
        : {
            executedAt: opts.executedAt,
            testRun: {
              project: {
                editResultsDurationSeconds: opts.projectSeconds ?? null,
              },
            },
          }
    ),
  };
  return { appConfig, testRunResults } as any;
}

describe("readEditResultsDurationSeconds", () => {
  it("returns null when no row is configured", async () => {
    expect(await readEditResultsDurationSeconds(makeClient({}))).toBeNull();
  });

  it("returns the numeric value and accepts numeric strings", async () => {
    expect(
      await readEditResultsDurationSeconds(makeClient({ systemDuration: 3600 }))
    ).toBe(3600);
    expect(
      await readEditResultsDurationSeconds(
        makeClient({ systemDuration: "120" })
      )
    ).toBe(120);
  });

  it("returns null for a non-numeric value", async () => {
    expect(
      await readEditResultsDurationSeconds(
        makeClient({ systemDuration: "soon" })
      )
    ).toBeNull();
  });
});

describe("resolveEffectiveWindowSeconds (system ceiling, projects tighten only)", () => {
  it("system 0 disables everywhere regardless of project override", () => {
    expect(resolveEffectiveWindowSeconds(0, null)).toBe(0);
    expect(resolveEffectiveWindowSeconds(0, 9999)).toBe(0);
  });

  it("system null defers entirely to the project value", () => {
    expect(resolveEffectiveWindowSeconds(null, null)).toBeNull();
    expect(resolveEffectiveWindowSeconds(null, 0)).toBe(0);
    expect(resolveEffectiveWindowSeconds(null, 300)).toBe(300);
  });

  it("system N is a ceiling: project inherits, tightens, or disables", () => {
    expect(resolveEffectiveWindowSeconds(600, null)).toBe(600); // inherit max
    expect(resolveEffectiveWindowSeconds(600, 120)).toBe(120); // tighten
    expect(resolveEffectiveWindowSeconds(600, 0)).toBe(0); // project disables
    expect(resolveEffectiveWindowSeconds(600, 9999)).toBe(600); // capped at max
  });
});

describe("assertResultEditWindowOpen", () => {
  const recent = () => new Date();
  const old = (ageSeconds: number) =>
    new Date(Date.now() - (ageSeconds + 5) * 1000);

  it("always allows system admins without touching config or the result", async () => {
    const client = makeClient({ systemDuration: 0 });
    await expect(
      assertResultEditWindowOpen(client, 1, "ADMIN")
    ).resolves.toBeUndefined();
    expect(client.appConfig.findUnique).not.toHaveBeenCalled();
    expect(client.testRunResults.findUnique).not.toHaveBeenCalled();
  });

  it("allows when neither system nor project sets a window", async () => {
    await expect(
      assertResultEditWindowOpen(
        makeClient({ executedAt: old(99999) }),
        1,
        "USER"
      )
    ).resolves.toBeUndefined();
  });

  it("rejects all non-admin edits when the system disables editing (0)", async () => {
    await expect(
      assertResultEditWindowOpen(
        makeClient({ systemDuration: 0, executedAt: recent() }),
        1,
        "USER"
      )
    ).rejects.toBeInstanceOf(EditWindowExpiredError);
  });

  it("rejects when a project disables editing even though the system allows a window", async () => {
    await expect(
      assertResultEditWindowOpen(
        makeClient({
          systemDuration: 3600,
          projectSeconds: 0,
          executedAt: recent(),
        }),
        1,
        "PROJECTADMIN"
      )
    ).rejects.toBeInstanceOf(EditWindowExpiredError);
  });

  it("allows an edit inside the effective window", async () => {
    await expect(
      assertResultEditWindowOpen(
        makeClient({ systemDuration: 3600, executedAt: recent() }),
        1,
        "USER"
      )
    ).resolves.toBeUndefined();
  });

  it("rejects an edit after the effective window has elapsed", async () => {
    await expect(
      assertResultEditWindowOpen(
        makeClient({ systemDuration: 60, executedAt: old(60) }),
        1,
        "USER"
      )
    ).rejects.toBeInstanceOf(EditWindowExpiredError);
  });

  it("honors a tightened project window below the system max", async () => {
    // System allows 1h, project tightens to 60s; a 5-minute-old result is now
    // outside the project window even though it is inside the system max.
    await expect(
      assertResultEditWindowOpen(
        makeClient({
          systemDuration: 3600,
          projectSeconds: 60,
          executedAt: old(300),
        }),
        1,
        "USER"
      )
    ).rejects.toBeInstanceOf(EditWindowExpiredError);
  });

  it("does not block (masking 404) when the result row is missing", async () => {
    await expect(
      assertResultEditWindowOpen(
        makeClient({ systemDuration: 60, executedAt: null }),
        999,
        "USER"
      )
    ).resolves.toBeUndefined();
  });
});

describe("isEditWindowExpiredError", () => {
  it("recognizes the typed error and the code shape", () => {
    expect(isEditWindowExpiredError(new EditWindowExpiredError())).toBe(true);
    expect(isEditWindowExpiredError({ code: "EDIT_WINDOW_EXPIRED" })).toBe(
      true
    );
    expect(isEditWindowExpiredError(new Error("other"))).toBe(false);
  });
});
