import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enUS from "~/messages/en-US.json";

const { apiFetch, toastError } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  toastError: vi.fn(),
}));

// The global setup stubs next-intl; these tests assert the real English text.
vi.unmock("next-intl");
vi.mock("~/lib/basePath", () => ({ apiFetch }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/components/tables/Filter", () => ({ Filter: () => null }));
// The real table is virtualized and renders no rows in jsdom.
vi.mock("@/components/tables/DataTable", () => ({
  DataTable: ({ columns, data, rowTestIdPrefix }: any) => {
    const actions = columns.find((column: any) => column.id === "actions");
    return (
      <div>
        {data.map((row: any) => (
          <div key={row.id} data-testid={`${rowTestIdPrefix}-${row.id}`}>
            {actions.cell({ row: { original: row } })}
          </div>
        ))}
      </div>
    );
  },
}));

import SoftDeletedDataTable from "./SoftDeletedDataTable";

const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  statusText: "",
  json: async () => body,
});

function renderTable(itemType = "User") {
  return render(
    <NextIntlClientProvider locale="en-US" messages={enUS}>
      <SoftDeletedDataTable
        itemType={itemType}
        translationKey="common.fields.users"
      />
    </NextIntlClientProvider>
  );
}

async function confirm(action: "Purge" | "Restore") {
  const row = await screen.findByTestId("trash-User-row-u1");
  fireEvent.click(
    Array.from(row.querySelectorAll("button")).find((button) =>
      button.textContent?.includes(action)
    )!
  );
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(
    Array.from(dialog.querySelectorAll("button")).find((button) =>
      button.textContent?.includes(action)
    )!
  );
}

describe("SoftDeletedDataTable", () => {
  const list = json({ items: [{ id: "u1", name: "Dana" }], totalCount: 1 });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("tells the admin why a purge failed and keeps the row", async () => {
    const reason =
      "Failed to purge User: records in ScimToken still reference it. Remove those records first.";
    apiFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE" ? json({ error: reason }, 409) : list
    );
    renderTable();

    await confirm("Purge");

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        `Could not purge this row from the Users table: ${reason}`
      )
    );
    expect(screen.getByTestId("trash-User-row-u1")).toBeInTheDocument();
  });

  it("tells the admin why a restore failed", async () => {
    apiFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "PATCH"
        ? json({ error: "User with ID u1 not found." }, 404)
        : list
    );
    renderTable();

    await confirm("Restore");

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Could not restore this row from the Users table: User with ID u1 not found."
      )
    );
  });

  it("reloads the list after a successful purge", async () => {
    apiFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE" ? json({ message: "purged" }) : list
    );
    renderTable();

    await confirm("Purge");

    await waitFor(() =>
      expect(
        apiFetch.mock.calls.filter(([, init]) => !init?.method)
      ).toHaveLength(2)
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it("says a purged user's content is kept", async () => {
    apiFetch.mockResolvedValue(list);
    renderTable();

    const row = await screen.findByTestId("trash-User-row-u1");
    fireEvent.click(
      Array.from(row.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Purge")
      )!
    );

    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      "Everything they created is kept and shown as created by a deleted user."
    );
  });
});
