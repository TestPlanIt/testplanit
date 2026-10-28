import { beforeEach, describe, expect, it } from "vitest";

import {
  composeUrlSearch,
  releaseUrlWriteOverlay,
  resetUrlWriteOverlay,
} from "./urlParamWrite";

const PATH = "/en-US/projects/repository/1";

describe("composeUrlSearch", () => {
  beforeEach(() => resetUrlWriteOverlay());

  it("composes from the current URL when nothing is pending", () => {
    expect(
      composeUrlSearch(PATH, "?page=1", (p) => p.set("view", "states"))
    ).toBe("page=1&view=states");
  });

  it("returns null when the mutation changes nothing, so the caller does not navigate", () => {
    expect(
      composeUrlSearch(PATH, "?view=states", (p) => p.set("view", "states"))
    ).toBeNull();
  });

  // The regression this module exists for: two writers composing from the same
  // pre-write URL. Without the overlay the second drops the first's param.
  it("keeps an earlier write's param when a second writer composes from the same stale URL", () => {
    composeUrlSearch(PATH, "?page=1", (p) => p.set("view", "states"));
    const second = composeUrlSearch(PATH, "?page=1", (p) =>
      p.set("columns", "name")
    );
    expect(second).toBe("page=1&view=states&columns=name");
  });

  it("chains across three writers landing in the same tick", () => {
    composeUrlSearch(PATH, "", (p) => p.set("view", "states"));
    composeUrlSearch(PATH, "", (p) => p.set("columns", "name"));
    const third = composeUrlSearch(PATH, "", (p) => p.set("page", "2"));
    expect(new URLSearchParams(third!).get("view")).toBe("states");
    expect(new URLSearchParams(third!).get("columns")).toBe("name");
  });

  it("composes from the real URL again once the browser has caught up", () => {
    composeUrlSearch(PATH, "?page=1", (p) => p.set("view", "states"));
    // The router committed: window.location now shows the written value.
    expect(
      composeUrlSearch(PATH, "?page=1&view=states", (p) =>
        p.set("columns", "name")
      )
    ).toBe("page=1&view=states&columns=name");
  });

  it("never applies an overlay left by another path", () => {
    composeUrlSearch("/en-US/projects/repository/1", "", (p) =>
      p.set("node", "9")
    );
    const other = composeUrlSearch("/en-US/projects/runs/2", "", (p) =>
      p.set("page", "1")
    );
    expect(other).toBe("page=1");
    expect(new URLSearchParams(other!).has("node")).toBe(false);
  });
});

describe("releaseUrlWriteOverlay", () => {
  beforeEach(() => resetUrlWriteOverlay());

  it("drops the overlay once the URL moves off what it was composed against", () => {
    composeUrlSearch(PATH, "?page=1", (p) => p.set("view", "states"));
    releaseUrlWriteOverlay(PATH, "?page=1&view=states");
    // Overlay gone: a writer composing from a now-stale read gets no help.
    expect(
      composeUrlSearch(PATH, "?page=1", (p) => p.set("columns", "name"))
    ).toBe("page=1&columns=name");
  });

  it("keeps the overlay while the URL still shows the pre-write value", () => {
    composeUrlSearch(PATH, "?page=1", (p) => p.set("view", "states"));
    releaseUrlWriteOverlay(PATH, "?page=1");
    expect(
      composeUrlSearch(PATH, "?page=1", (p) => p.set("columns", "name"))
    ).toBe("page=1&view=states&columns=name");
  });
});
