import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());

vi.mock("~/lib/basePath", () => ({ apiFetch }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null }),
}));
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));
// Radix Select needs pointer capture, which jsdom lacks.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <select
      data-testid="qase-previous-imports"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectItem: ({ value }: { value: string }) => (
    <option value={value}>{value}</option>
  ),
}));
vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: ({ date }: { date: string }) => <span>{date}</span>,
}));

import { QaseImportPanel } from "./QaseImportPanel";

const ok = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

const demo = {
  code: "DEMO",
  title: "Getting Started",
  cases: 51,
  suites: 27,
  milestones: 2,
  runs: 0,
  defects: 1,
};

const job = (overrides: Record<string, unknown> = {}) => ({
  id: "job-1",
  status: "READY",
  phase: "CONFIGURING",
  statusMessage: null,
  error: null,
  apiHost: "api.qase.io",
  projects: [demo],
  fetchProgress: { case: { fetched: 51, total: 51, done: true } },
  currentEntity: null,
  cancelRequested: false,
  createdAt: "2026-11-20T10:00:00.000Z",
  startedAt: null,
  completedAt: null,
  canceledAt: null,
  durationMs: 4000,
  ...overrides,
});

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <QaseImportPanel />
    </QueryClientProvider>
  );
}

describe("QaseImportPanel", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/imports/qase/jobs?limit=20") {
        return ok({ jobs: [] });
      }
      if (url === "/api/imports/qase/projects") {
        return ok({ host: "api.qase.io", projects: [demo] });
      }
      if (url === "/api/imports/qase/jobs" && init?.method === "POST") {
        return ok({ job: job() }, 201);
      }
      if (url === "/api/imports/qase/jobs/job-1") {
        return ok({ job: job() });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
  });

  it("connects, lists the projects and starts the fetch", async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(screen.getByTestId("qase-connect-button")).toBeDisabled();
    await user.type(screen.getByTestId("qase-token-input"), "secret-token");
    await user.click(screen.getByTestId("qase-connect-button"));

    const checkbox = await screen.findByTestId("qase-project-DEMO");
    expect(checkbox).toBeChecked();
    expect(screen.getByText("Getting Started (DEMO)")).toBeInTheDocument();

    await user.click(screen.getByTestId("qase-fetch-button"));

    await waitFor(() =>
      expect(screen.getByTestId("qase-job-status")).toHaveTextContent(
        "admin.imports.qase.status.READY"
      )
    );
    const create = apiFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/imports/qase/jobs" && init?.method === "POST"
    );
    expect(JSON.parse(create![1].body)).toEqual({
      token: "secret-token",
      host: "api.qase.io",
      projectCodes: ["DEMO"],
    });
    expect(screen.getByTestId("qase-count-case")).toHaveTextContent("51");
    expect(screen.queryByTestId("qase-token-input")).not.toBeInTheDocument();
  });

  it("disables the fetch when no project is selected", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByTestId("qase-token-input"), "secret-token");
    await user.click(screen.getByTestId("qase-connect-button"));
    await user.click(await screen.findByTestId("qase-project-DEMO"));

    expect(screen.getByTestId("qase-fetch-button")).toBeDisabled();
  });

  it("shows the translated reason when Qase rejects the token", async () => {
    apiFetch.mockImplementation(async (url: string) =>
      url === "/api/imports/qase/projects"
        ? ok(
            { error: "Qase rejected the API token.", code: "unauthorized" },
            400
          )
        : ok({ jobs: [] })
    );
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByTestId("qase-token-input"), "bad");
    await user.click(screen.getByTestId("qase-connect-button"));

    expect(await screen.findByTestId("qase-import-error")).toHaveTextContent(
      "admin.imports.qase.errors.unauthorized"
    );
    expect(screen.queryByTestId("qase-project-list")).not.toBeInTheDocument();
  });

  it("opens a previous import and cancels it while the fetch runs", async () => {
    let current = job({ status: "RUNNING", phase: "FETCHING" });
    apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/imports/qase/jobs?limit=20") {
        return ok({ jobs: [current] });
      }
      if (url === "/api/imports/qase/jobs/job-1" && init?.method === "POST") {
        current = job({ status: "RUNNING", cancelRequested: true });
        return ok({ job: current });
      }
      return ok({ job: current });
    });
    const user = userEvent.setup();
    renderPanel();

    await screen.findByRole("option", { name: "job-1" });
    await user.selectOptions(
      screen.getByTestId("qase-previous-imports"),
      "job-1"
    );

    const cancel = await screen.findByTestId("qase-cancel-button");
    expect(screen.queryByTestId("qase-delete-button")).not.toBeInTheDocument();
    await user.click(cancel);
    await waitFor(() =>
      expect(screen.getByTestId("qase-cancel-button")).toBeDisabled()
    );
  });
});
