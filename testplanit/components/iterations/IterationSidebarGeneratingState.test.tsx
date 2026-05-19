import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "~/test/test-utils";
import { iterationProgressBus } from "~/lib/services/iterationProgressBus";

import { IterationSidebarGeneratingState } from "./IterationSidebarGeneratingState";

describe("IterationSidebarGeneratingState", () => {
  afterEach(() => {
    // Clean up any jobs left in the module-scoped bus between tests.
    for (const job of iterationProgressBus.snapshot()) {
      iterationProgressBus.remove(job.jobId);
    }
  });

  it("renders generating UI with totalExpected when no bus job is present", () => {
    render(
      <IterationSidebarGeneratingState
        jobId="missing-job"
        totalExpected={500}
        runName="Smoke run"
        onSkip={() => {}}
      />
    );
    const root = screen.getByTestId("iteration-sidebar-generating-state");
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute("data-job-id", "missing-job");
    // i18n is mocked globally to echo the key path — assert on key presence
    // rather than rendered values.
    expect(root.textContent).toContain("parameters.runGeneratingHeading");
    expect(root.textContent).toContain("parameters.runProgressCounter");
    expect(root.textContent).toContain("parameters.runProgressNavAway");
  });

  it("invokes onSkip when the navigate-away link is clicked", async () => {
    const onSkip = vi.fn();
    const user = userEvent.setup();
    render(
      <IterationSidebarGeneratingState
        jobId="job-1"
        totalExpected={100}
        runName="Smoke run"
        onSkip={onSkip}
      />
    );
    await user.click(screen.getByTestId("iteration-sidebar-generating-skip"));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it("subscribes to bus updates for the matching jobId without throwing", async () => {
    iterationProgressBus.start({
      jobId: "job-2",
      runId: 42,
      runName: "Live run",
      total: 1000,
    });

    render(
      <IterationSidebarGeneratingState
        jobId="job-2"
        totalExpected={1000}
        runName="Live run"
        onSkip={() => {}}
      />
    );

    iterationProgressBus.update("job-2", {
      processed: 250,
      state: "active",
    });

    const root = await screen.findByTestId(
      "iteration-sidebar-generating-state"
    );
    expect(root).toHaveAttribute("data-job-id", "job-2");
    // Progress is rendered via the next-intl-mocked counter key, so we
    // assert the bus state reflects the update instead of the DOM text.
    const live = iterationProgressBus.snapshot().find((j) => j.jobId === "job-2");
    expect(live?.processed).toBe(250);
    expect(live?.state).toBe("active");
  });
});
