import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteCaseModal } from "./DeleteCase";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("~/zenstack/schema", () => ({ schema: {} }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    repositoryCases: { useUpdate: () => ({ mutateAsync: mocks.update }) },
  }),
}));

const confirm = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "common.actions.confirmDelete" })
  );

describe("DeleteCaseModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockResolvedValue({});
  });

  it("deletes the case itself and reports success", async () => {
    const onClose = vi.fn();
    const onDeleteSuccess = vi.fn();
    render(
      <DeleteCaseModal
        testcase={{ id: 7, name: "Checkout" }}
        open
        onClose={onClose}
        onDeleteSuccess={onDeleteSuccess}
      />
    );
    confirm();
    await waitFor(() => expect(onDeleteSuccess).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledWith({
      data: { isDeleted: true },
      where: { id: 7 },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("hands the delete to onConfirm when one is given", async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <DeleteCaseModal
        testcase={{ id: 7, name: "Checkout" }}
        open
        onClose={onClose}
        onConfirm={onConfirm}
      />
    );
    confirm();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("warns when the case is in an active test run", () => {
    render(
      <DeleteCaseModal
        testcase={{
          id: 7,
          name: "Checkout",
          testRunCases: [
            { testRun: { isDeleted: false, isCompleted: false } },
            { testRun: { isDeleted: false, isCompleted: true } },
          ],
        }}
        open
        onClose={() => {}}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "repository.deleteCase.activeRunWarningMessage"
    );
  });
});
