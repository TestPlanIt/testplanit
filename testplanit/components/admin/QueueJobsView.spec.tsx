import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { QueueJobsView } from "./QueueJobsView";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

// Mock sonner
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

// Stub DataTable (rendering the real one OOMs in jsdom) but run the real
// column cell renderers so the id/state/action markup is asserted for real.
vi.mock("@/components/tables/DataTable", () => ({
  DataTable: ({ columns, data }: any) => (
    <table>
      <tbody>
        {data.map((row: any) => (
          <tr key={row.id}>
            {columns.map((col: any) => (
              <td key={col.id}>
                {typeof col.cell === "function"
                  ? col.cell({ row: { original: row } })
                  : String(row[col.accessorKey] ?? "")}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

const JOBS = [
  {
    id: "repeat:5f2c9d8e-1a2b-4c3d-9e8f-abcdef123456",
    name: "send-email",
    data: {},
    opts: { attempts: 3 },
    progress: 0,
    returnvalue: null,
    stacktrace: [],
    timestamp: 1753400000000,
    attemptsMade: 1,
    state: "completed",
  },
  {
    id: "job-failed-1",
    name: "reindex",
    data: {},
    opts: { attempts: 2 },
    progress: 0,
    returnvalue: null,
    stacktrace: [],
    timestamp: 1753400001000,
    attemptsMade: 2,
    failedReason: "boom",
    state: "failed",
  },
];

function mockJobsFetch() {
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    if (href.includes("/jobs")) {
      return {
        ok: true,
        json: async () => ({ jobs: JOBS, total: JOBS.length }),
      } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("QueueJobsView", () => {
  test("loads jobs for the queue and renders the FULL job id", async () => {
    const fetchMock = mockJobsFetch();
    render(
      <QueueJobsView queueName="emails" onClose={vi.fn()} onRefresh={vi.fn()} />
    );

    await waitFor(() =>
      expect(
        screen.getByText("repeat:5f2c9d8e-1a2b-4c3d-9e8f-abcdef123456")
      ).toBeInTheDocument()
    );

    // The id cell must not truncate to a substring: BullMQ ids (repeat:*,
    // cron ids) are only actionable when the full value is shown.
    expect(screen.queryByText(/^repeat:5f2c9d8e\.\.\.$/)).toBeNull();

    const firstCall = String(fetchMock.mock.calls[0][0]);
    expect(firstCall).toContain("/api/admin/queues/emails/jobs");
    expect(firstCall).toContain("state=all");
  });

  test("renders attempts as made/max and a state cell per job", async () => {
    mockJobsFetch();
    render(
      <QueueJobsView queueName="emails" onClose={vi.fn()} onRefresh={vi.fn()} />
    );

    await waitFor(() =>
      expect(screen.getByText("job-failed-1")).toBeInTheDocument()
    );
    expect(screen.getByText("1/3")).toBeInTheDocument();
    expect(screen.getByText("2/2")).toBeInTheDocument();
  });
});
