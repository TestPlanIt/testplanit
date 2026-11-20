import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LoadFromVersionMenu, loadableVersions } from "./LoadFromVersionMenu";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: () => <span>{"date"}</span>,
}));

const versions = [
  { version: 3, createdAt: "2026-03-01T00:00:00.000Z" },
  { version: 2, createdAt: "2026-02-01T00:00:00.000Z" },
  { version: 1, createdAt: "2026-01-01T00:00:00.000Z" },
];

describe("loadableVersions", () => {
  it("leaves out the version the case is at", () => {
    expect(loadableVersions(versions, 3).map((v) => v.version)).toEqual([2, 1]);
  });

  it("is empty when there are no versions", () => {
    expect(loadableVersions(undefined, 1)).toEqual([]);
  });
});

describe("LoadFromVersionMenu", () => {
  const setup = (hasUnsavedEdits: boolean, list = versions) => {
    const onLoad = vi.fn();
    render(
      <LoadFromVersionMenu
        versions={list}
        currentVersion={3}
        hasUnsavedEdits={() => hasUnsavedEdits}
        onLoad={onLoad}
      />
    );
    return { onLoad, user: userEvent.setup() };
  };

  it("renders nothing when the case has only its current version", () => {
    setup(false, [versions[0]]);
    expect(
      screen.queryByTestId("load-from-version-button")
    ).not.toBeInTheDocument();
  });

  it("lists the earlier versions and loads the one picked", async () => {
    const { onLoad, user } = setup(false);
    await user.click(screen.getByTestId("load-from-version-button"));

    expect(screen.queryByTestId("load-from-version-3")).not.toBeInTheDocument();
    await user.click(await screen.findByTestId("load-from-version-2"));

    expect(onLoad).toHaveBeenCalledWith(2);
    expect(
      screen.queryByTestId("load-from-version-confirm")
    ).not.toBeInTheDocument();
  });

  it("asks before replacing unsaved edits, and loads on confirmation", async () => {
    const { onLoad, user } = setup(true);
    await user.click(screen.getByTestId("load-from-version-button"));
    await user.click(await screen.findByTestId("load-from-version-1"));

    expect(onLoad).not.toHaveBeenCalled();
    await user.click(
      await screen.findByTestId("load-from-version-confirm-action")
    );
    expect(onLoad).toHaveBeenCalledWith(1);
  });

  it("loads nothing when the confirmation is cancelled", async () => {
    const { onLoad, user } = setup(true);
    await user.click(screen.getByTestId("load-from-version-button"));
    await user.click(await screen.findByTestId("load-from-version-1"));
    await user.click(await screen.findByTestId("load-from-version-cancel"));

    expect(onLoad).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("load-from-version-confirm")
    ).not.toBeInTheDocument();
  });
});
