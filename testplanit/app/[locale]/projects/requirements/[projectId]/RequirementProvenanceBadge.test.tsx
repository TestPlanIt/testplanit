import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, any>) =>
    params ? `${key}:${Object.values(params).join("·")}` : key,
}));

const { mockRouterRefresh } = vi.hoisted(() => ({
  mockRouterRefresh: vi.fn(),
}));

vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ refresh: mockRouterRefresh }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

let mockIsProjectAdmin = true;
vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: () => ({
    permissions: null,
    isProjectAdmin: mockIsProjectAdmin,
    isLoading: false,
  }),
}));

import {
  COLLAPSE_HYSTERESIS_PX,
  RequirementProvenanceBadge,
} from "./RequirementProvenanceBadge";

const nativeRow = {
  id: 1,
  isRequirement: true,
  integrationId: null,
  requirementDetachedAt: null,
  externalKey: null,
  externalUrl: null,
  issueTypeIconUrl: null,
};

const lockedRow = {
  id: 2,
  isRequirement: true,
  integrationId: 9,
  requirementDetachedAt: null,
  externalKey: "REQ-100",
  externalUrl: "https://jira.example.com/browse/REQ-100",
  issueTypeIconUrl: null,
};

const detachedRow = {
  ...lockedRow,
  id: 3,
  requirementDetachedAt: new Date().toISOString(),
};

/** Opens the Radix DropdownMenu trigger — fireEvent.click alone doesn't
 * dispatch the pointerdown/pointerup sequence Radix listens for in jsdom. */
function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
  fireEvent.pointerUp(trigger, { button: 0, pointerId: 1 });
}

// --- Driven-ResizeObserver harness (gap closure, 26.2-09) ---------------
// jsdom's zero-width `getBoundingClientRect` plus the global
// `MockResizeObserver`'s no-op `observe` mean nothing before this drove a
// real width through this badge's collapse effect.
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  private callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  trigger() {
    act(() => {
      this.callback(
        [] as unknown as ResizeObserverEntry[],
        this as unknown as ResizeObserver
      );
    });
  }
}

const rectWidths = new WeakMap<Element, number>();
function setRectWidth(el: Element, width: number) {
  rectWidths.set(el, width);
}

let originalResizeObserver: typeof globalThis.ResizeObserver;
let originalGetBoundingClientRect: typeof HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  FakeResizeObserver.instances = [];
  originalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  originalGetBoundingClientRect =
    HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (
    this: HTMLElement
  ) {
    const width = rectWidths.get(this) ?? 0;
    return {
      width,
      height: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    } as DOMRect;
  };
});

afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

/** Locates the measuring copy (`aria-hidden="true"`, always rendered at
 *  FULL content) and its wrapper (the actual `ResizeObserver` target) for
 *  the three-segment provenance ladder, plus each individually-measured
 *  segment inside the copy. */
function getProvenanceHarness(container: HTMLElement) {
  const icon = container.querySelector('[data-seg="icon"]');
  if (!icon) throw new Error("icon segment not found");
  const measure = icon.closest('[aria-hidden="true"]');
  if (!measure) throw new Error("measuring copy not found");
  const wrap = measure.parentElement;
  if (!wrap) throw new Error("wrapper not found");
  const provider = measure.querySelector('[data-seg="provider"]');
  const label = measure.querySelector('[data-seg="label"]');
  if (!provider || !label) throw new Error("segment(s) not found");
  return { measure, wrap, icon, provider, label };
}

describe("RequirementProvenanceBadge", () => {
  beforeEach(() => {
    mockRouterRefresh.mockReset();
    mockIsProjectAdmin = true;
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as any;
  });

  it("renders no synced badge for a native requirement with no integrationId", () => {
    render(
      <RequirementProvenanceBadge requirement={nativeRow} projectId={7} />
    );
    expect(screen.queryByTestId("requirement-provenance-locked")).toBeNull();
    expect(screen.queryByTestId("requirement-provenance-detached")).toBeNull();
  });

  it("renders the locked badge for a synced, non-detached requirement", () => {
    render(
      <RequirementProvenanceBadge requirement={lockedRow} projectId={7} />
    );
    const badge = screen.getByTestId("requirement-provenance-locked");
    expect(badge).toBeInTheDocument();
    // PROV-01's lock signal is the badge's own state word, not a separate
    // lock glyph — the glyph was removed because it repeated what the word
    // already said. Assert the two states are actually distinguishable.
    expect(badge).toHaveTextContent("syncedLabel");
    expect(badge).not.toHaveTextContent("detachedLabel");
    // The badge names the tracker rather than repeating the issue key — both
    // surfaces that render it already lead with the shared "KEY: Title"
    // label, so the key was printing twice on one row. This mirrors a synced
    // milestone's badge.
    expect(badge).toHaveTextContent("Jira");
  });

  it("renders the detached badge, keeping the tracker reference, for a detached requirement", () => {
    render(
      <RequirementProvenanceBadge requirement={detachedRow} projectId={7} />
    );
    const badge = screen.getByTestId("requirement-provenance-detached");
    expect(badge).toBeInTheDocument();
    // PROV-02's "keeps a Jira reference badge" after detaching. The proof is
    // the reference still being REACHABLE, not the key being printed inside
    // the badge: the tracker is named, and the link out is rendered. A
    // clickable way back to Jira is a stronger guarantee than a string.
    expect(badge).toHaveTextContent("Jira");
    expect(
      screen.getByTestId("requirement-open-in-tracker")
    ).toBeInTheDocument();
    // The counterpart of the locked assertion above: a detached row reads
    // "Detached", never "Synced".
    expect(badge).toHaveTextContent("detachedLabel");
    expect(badge).not.toHaveTextContent("syncedLabel");
  });

  it("offers the detach action only to a project admin", () => {
    const { rerender } = render(
      <RequirementProvenanceBadge requirement={lockedRow} projectId={7} />
    );
    openMenu(screen.getByTestId("requirement-provenance-locked"));
    expect(
      screen.getByTestId("requirement-provenance-menu-detach")
    ).toBeInTheDocument();

    mockIsProjectAdmin = false;
    rerender(
      <RequirementProvenanceBadge requirement={lockedRow} projectId={7} />
    );
    expect(
      screen.queryByTestId("requirement-provenance-menu-detach")
    ).toBeNull();
  });

  it("posts to the detach route and never uses a native confirm dialog", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    render(
      <RequirementProvenanceBadge requirement={lockedRow} projectId={7} />
    );

    openMenu(screen.getByTestId("requirement-provenance-locked"));
    fireEvent.click(screen.getByTestId("requirement-provenance-menu-detach"));
    expect(
      screen.getByTestId("requirement-provenance-detach-confirm")
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId("requirement-provenance-detach-confirm")
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/projects/7/requirements/2/detach",
        { method: "POST" }
      );
    });
    await waitFor(() => {
      expect(mockRouterRefresh).toHaveBeenCalled();
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  // jsdom has no layout, so the progressive collapse itself can't be
  // exercised here — every getBoundingClientRect is 0 and the effect bails.
  // What CAN be pinned is the structure the collapse depends on, which is
  // exactly where the first attempt went wrong: the measuring copy was
  // absolutely positioned, so the wrapper requested no width, the row never
  // squeezed the badge, and the requirement's TITLE truncated instead.
  it("keeps the measuring copy in flow so the badge competes for row space", () => {
    const { container } = render(
      <RequirementProvenanceBadge requirement={lockedRow} projectId={7} />
    );

    const measure = container.querySelector('[aria-hidden="true"]');
    expect(measure).not.toBeNull();
    // Taken out of flow, the copy measures segments but stops holding the
    // wrapper's width open — half the mechanism, and the half that fails
    // silently.
    expect(measure!.className).not.toMatch(/\b(absolute|fixed)\b/);
    // Every segment the collapse steps through must be measurable.
    for (const seg of ["icon", "provider", "label"]) {
      expect(measure!.querySelector(`[data-seg="${seg}"]`)).not.toBeNull();
    }

    // The wrapper absorbs the row's entire width deficit, so the title never
    // pays for the badge.
    const wrapper = measure!.parentElement!;
    expect(wrapper.className).toMatch(/shrink-\[999\]/);
  });

  // --- Driven-ResizeObserver tests (26.2-09 gap closure) -----------------
  //
  // Segment widths are fixed by the harness: icon=10, provider=20, label=15,
  // chrome=5 (full = 50). Level thresholds fall out of `compute()`'s own
  // cumulative-sum loop: level 0->1 at available>=34.5 (chrome+icon+provider
  // = 35, minus the 0.5 epsilon), level 1->2 at available>=49.5 (+label=15).
  describe("driven collapse decision (26.2-09)", () => {
    const ICON_W = 10;
    const PROVIDER_W = 20;
    const LABEL_W = 15;
    const FULL_WIDTH = ICON_W + PROVIDER_W + LABEL_W + 5; // + chrome

    function seedSegments(h: ReturnType<typeof getProvenanceHarness>) {
      setRectWidth(h.measure, FULL_WIDTH);
      setRectWidth(h.icon, ICON_W);
      setRectWidth(h.provider, PROVIDER_W);
      setRectWidth(h.label, LABEL_W);
    }

    it("sits at the top level (provider and state word both shown) when the wrapper is comfortably wide", () => {
      const { container } = render(
        <RequirementProvenanceBadge requirement={lockedRow} projectId={7} />
      );
      const badge = screen.getByTestId("requirement-provenance-locked");
      const h = getProvenanceHarness(container);
      seedSegments(h);
      setRectWidth(h.wrap, FULL_WIDTH + 20); // comfortably wide
      FakeResizeObserver.instances[
        FakeResizeObserver.instances.length - 1
      ]!.trigger();

      expect(badge).toHaveTextContent("sync.providerJira");
      expect(badge).toHaveTextContent("syncedLabel");
    });

    it("drops to the bare Jira mark (no provider, no state word) when the wrapper is comfortably narrow", () => {
      const { container } = render(
        <RequirementProvenanceBadge requirement={lockedRow} projectId={7} />
      );
      const badge = screen.getByTestId("requirement-provenance-locked");
      const h = getProvenanceHarness(container);
      seedSegments(h);
      setRectWidth(h.wrap, 10); // well below even the icon-only floor
      FakeResizeObserver.instances[
        FakeResizeObserver.instances.length - 1
      ]!.trigger();

      expect(badge).not.toHaveTextContent("sync.providerJira");
      expect(badge).not.toHaveTextContent("syncedLabel");
    });

    // THE REGRESSION TEST for the update-depth defect (26.2-09 task 1's
    // attribution): `compute()`'s level 0->1 boundary sits at
    // available>=34.5; two widths 0.2px apart straddle it.
    //
    // Counts TRANSITIONS in the rendered provider segment rather than raw
    // React commits: this badge mounts inside a Radix `DropdownMenu`, whose
    // own internal trigger-size tracking adds an extra commit alongside the
    // first genuine level change (observed directly: a single `setLevel`
    // call following two raw commits under `Profiler`) -- a library
    // implementation detail, not a second alternation of THIS component's
    // own decision. Transition-counting on the actually-rendered output is
    // what the defect is about and survives that noise.
    //
    // Pre-fix RED (captured verbatim, 26.2-09-SUMMARY.md carries the full
    // run):
    //   AssertionError: expected 20 to be less than or equal to 1
    it("settles after at most one state change when the wrapper width jitters across a level boundary", () => {
      const { container } = render(
        <RequirementProvenanceBadge requirement={lockedRow} projectId={7} />
      );
      const badge = screen.getByTestId("requirement-provenance-locked");
      const h = getProvenanceHarness(container);
      seedSegments(h);
      const ro =
        FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1]!;

      const belowThreshold = 34.4;
      const aboveThreshold = 34.6;

      let transitions = 0;
      let last = badge.textContent?.includes("sync.providerJira") ?? false;
      for (let i = 0; i < 20; i++) {
        setRectWidth(h.wrap, i % 2 === 0 ? belowThreshold : aboveThreshold);
        ro.trigger();
        const current = badge.textContent?.includes("sync.providerJira") ?? false;
        if (current !== last) {
          transitions += 1;
          last = current;
        }
      }

      expect(transitions).toBeLessThanOrEqual(1);
    });

    it("drops a level on the way down but withholds it until width clears the hysteresis band on the way back up", () => {
      const { container } = render(
        <RequirementProvenanceBadge requirement={lockedRow} projectId={7} />
      );
      const badge = screen.getByTestId("requirement-provenance-locked");
      const h = getProvenanceHarness(container);
      seedSegments(h);
      const ro =
        FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1]!;

      // Start comfortably wide (level 2).
      setRectWidth(h.wrap, FULL_WIDTH + 20);
      ro.trigger();
      expect(badge).toHaveTextContent("sync.providerJira");

      // Sweep down past the level 0/1 boundary (35) -- drops immediately.
      setRectWidth(h.wrap, 20);
      ro.trigger();
      expect(badge).not.toHaveTextContent("sync.providerJira");

      // Sweep back up, but only just past the (pre-hysteresis) boundary --
      // must NOT return yet.
      setRectWidth(h.wrap, 36);
      ro.trigger();
      expect(badge).not.toHaveTextContent("sync.providerJira");

      // Clear the full hysteresis band (35 + COLLAPSE_HYSTERESIS_PX) -- now
      // it returns.
      setRectWidth(h.wrap, 35 + COLLAPSE_HYSTERESIS_PX + 1);
      ro.trigger();
      expect(badge).toHaveTextContent("sync.providerJira");
    });
  });
});
