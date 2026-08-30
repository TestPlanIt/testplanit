// The scope picker for the two requirement report types. The real
// MultiAsyncCombobox is a Radix popover that does not survive jsdom (the
// same reason RequirementsListView.test.tsx stubs it), so the stub below
// captures the props this suite actually exercises: the fetcher contract
// and the label plumbing.

import { render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/ui/help-popover", () => ({
  HelpPopover: () => <span data-testid="help-popover" />,
}));

const capturedProps: { current: any } = { current: null };
vi.mock("@/components/ui/multi-async-combobox", () => ({
  MultiAsyncCombobox: (props: any) => {
    capturedProps.current = props;
    return <button role="combobox" aria-label={props.ariaLabel} />;
  },
}));

import { RequirementScopePicker } from "./RequirementScopePicker";

const jiraRow = {
  id: 7,
  name: "ABT-1",
  title: "Enrolments",
  externalUrl: "https://tracker/ABT-1",
};
const nativeRow = { id: 9, name: "Payments", title: "Payments" };
const ancestorRow = {
  id: 3,
  name: "ABT-0",
  title: "Everything",
  externalUrl: "https://tracker/ABT-0",
};

describe("RequirementScopePicker", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    capturedProps.current = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderPicker(onValueChange = vi.fn()) {
    render(
      <RequirementScopePicker
        projectId={42}
        value={[]}
        onValueChange={onValueChange}
      />
    );
    return capturedProps.current;
  }

  it("serves the roots window for an empty query via GET", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [jiraRow, nativeRow] }),
    });

    const props = renderPicker();
    const result = await props.fetchOptions("", 0, 30);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/42/requirements/tree?limit=30"
    );
    expect(result).toEqual({ results: [jiraRow, nativeRow], total: 2 });
  });

  it("serves a typed query via the filtered POST, dropping ancestor rows", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        rows: [ancestorRow, jiraRow],
        matchedIds: [jiraRow.id],
      }),
    });

    const props = renderPicker();
    const result = await props.fetchOptions("enrol", 0, 30);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/42/requirements/tree",
      expect.objectContaining({ method: "POST" })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      search: "enrol",
      include: "rows",
      limit: 30,
      cursor: null,
    });
    // The ancestor row rides along for tree retention but never matched
    // the search — it must not become an option.
    expect(result).toEqual({ results: [jiraRow], total: 1 });
  });

  it("returns an empty page past page zero without fetching", async () => {
    const props = renderPicker();

    const result = await props.fetchOptions("enrol", 1, 30);

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("degrades a failed response to an empty option list", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });

    const props = renderPicker();

    await expect(props.fetchOptions("", 0, 30)).resolves.toEqual([]);
  });

  it("labels options with the shared KEY: Title convention", () => {
    const props = renderPicker();

    expect(props.getOptionLabel(jiraRow)).toBe("ABT-1: Enrolments");
    // A native requirement writes the same string to name and title, so
    // the label must not double it.
    expect(props.getOptionLabel(nativeRow)).toBe("Payments");
    expect(props.getOptionValue(jiraRow)).toBe(7);
  });

  it("names the trigger and renders the field label", () => {
    renderPicker();

    expect(
      screen.getByRole("combobox", {
        name: "requirementCoverage.scopeLabel",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText("requirementCoverage.scopeLabel")
    ).toBeInTheDocument();
  });
});
