import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "~/test/test-utils";

import { iterationProgressBus } from "~/lib/services/iterationProgressBus";

import { IterationSidebar } from "./IterationSidebar";
import type { IterationDTO, IterationParameterMeta } from "./types";

const replaceMock = vi.fn();

vi.mock("~/lib/navigation", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useRouter: () => ({
    replace: replaceMock,
    push: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => "/projects/runs/1/2",
  redirect: vi.fn(),
}));

const parametersSchema: IterationParameterMeta[] = [
  { name: "username", type: "STRING", order: 0 },
  { name: "password", type: "STRING", order: 1, sensitive: true },
];

function mkIteration(
  rowIndex: number,
  overrides: Partial<IterationDTO> = {}
): IterationDTO {
  return {
    id: 100 + rowIndex,
    rowIndex,
    valuesJson: { username: `user${rowIndex}`, password: "hunter2" },
    isCompleted: false,
    status: null,
    ...overrides,
  };
}

describe("IterationSidebar", () => {
  afterEach(() => {
    replaceMock.mockClear();
    for (const job of iterationProgressBus.snapshot()) {
      iterationProgressBus.remove(job.jobId);
    }
  });

  it("renders one row per iteration with the correct ordinal", () => {
    render(
      <IterationSidebar
        testRunCaseId={1}
        runId={2}
        iterations={[mkIteration(0), mkIteration(1), mkIteration(2)]}
        parametersSchema={parametersSchema}
        isRunCompleted={false}
        onIterationMenuAction={vi.fn()}
        onBulkSkip={vi.fn()}
      />
    );

    expect(screen.getByTestId("iteration-row-0")).toBeInTheDocument();
    expect(screen.getByTestId("iteration-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("iteration-row-2")).toBeInTheDocument();
    // Ordinal is 1-indexed
    expect(
      within(screen.getByTestId("iteration-row-0")).getByText("1")
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("iteration-row-2")).getByText("3")
    ).toBeInTheDocument();
  });

  it("masks sensitive parameters in the values summary", () => {
    render(
      <IterationSidebar
        testRunCaseId={1}
        runId={2}
        iterations={[mkIteration(0)]}
        parametersSchema={parametersSchema}
        isRunCompleted={false}
        onIterationMenuAction={vi.fn()}
        onBulkSkip={vi.fn()}
      />
    );
    const row = screen.getByTestId("iteration-row-0");
    expect(row.textContent).toContain("username: user0");
    expect(row.textContent).toContain("password: ••••••");
    expect(row.textContent).not.toContain("hunter2");
  });

  it("calls router.replace with the next iteration ordinal when a row is clicked", async () => {
    const user = userEvent.setup();
    render(
      <IterationSidebar
        testRunCaseId={1}
        runId={2}
        iterations={[mkIteration(0), mkIteration(1)]}
        parametersSchema={parametersSchema}
        isRunCompleted={false}
        onIterationMenuAction={vi.fn()}
        onBulkSkip={vi.fn()}
      />
    );
    await user.click(screen.getByTestId("iteration-row-1"));
    expect(replaceMock).toHaveBeenCalled();
    const args = replaceMock.mock.calls[0]?.[0] as string;
    expect(args).toContain("iteration=2");
  });

  it("Cmd/Ctrl+A selects all iterations and shows the bulk toolbar", async () => {
    const user = userEvent.setup();
    render(
      <IterationSidebar
        testRunCaseId={1}
        runId={2}
        iterations={[mkIteration(0), mkIteration(1)]}
        parametersSchema={parametersSchema}
        isRunCompleted={false}
        onIterationMenuAction={vi.fn()}
        onBulkSkip={vi.fn()}
      />
    );
    // Focus a row so the container check passes.
    const row = screen.getByTestId("iteration-row-0");
    row.focus();
    await user.keyboard("{Control>}a{/Control}");

    const toolbar = screen.getByTestId("iteration-bulk-toolbar");
    expect(toolbar.className).not.toContain("hidden");
    // Both rows should be marked as selected after Cmd/Ctrl+A.
    expect(screen.getByTestId("iteration-row-0")).toHaveAttribute(
      "data-selected",
      "true"
    );
    expect(screen.getByTestId("iteration-row-1")).toHaveAttribute(
      "data-selected",
      "true"
    );
  });

  it("Escape clears the selection", async () => {
    const user = userEvent.setup();
    render(
      <IterationSidebar
        testRunCaseId={1}
        runId={2}
        iterations={[mkIteration(0), mkIteration(1)]}
        parametersSchema={parametersSchema}
        isRunCompleted={false}
        onIterationMenuAction={vi.fn()}
        onBulkSkip={vi.fn()}
      />
    );
    const row = screen.getByTestId("iteration-row-0");
    row.focus();
    await user.keyboard("{Control>}a{/Control}");
    expect(
      screen.getByTestId("iteration-bulk-toolbar").className
    ).not.toContain("hidden");

    row.focus();
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("iteration-bulk-toolbar").className).toContain(
      "hidden"
    );
  });

  it("renders the generating state when no iterations exist and a job is queued", () => {
    iterationProgressBus.start({
      jobId: "job-x",
      runId: 7,
      runName: "smoke",
      total: 800,
    });
    render(
      <IterationSidebar
        testRunCaseId={1}
        runId={7}
        iterations={[]}
        parametersSchema={parametersSchema}
        isRunCompleted={false}
        onIterationMenuAction={vi.fn()}
        onBulkSkip={vi.fn()}
      />
    );
    expect(
      screen.getByTestId("iteration-sidebar-generating-state")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("iteration-sidebar-list")
    ).not.toBeInTheDocument();
  });
});
