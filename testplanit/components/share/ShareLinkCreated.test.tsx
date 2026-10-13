import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    `${namespace}.${key}`,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ShareLinkCreated } from "./ShareLinkCreated";

const baseShare = {
  shareUrl: "http://localhost/share/abc",
  mode: "AUTHENTICATED",
  entityType: "REPORT",
  expiresAt: null,
  notifyOnView: false,
  viewCount: 4,
};

function renderCreated(shareData: Record<string, unknown>) {
  return render(
    <ShareLinkCreated
      shareData={shareData}
      onClose={vi.fn()}
      onCreateAnother={vi.fn()}
    />
  );
}

function viewsValue() {
  const label = screen.getByText("reports.shareDialog.created.metadata.views");
  return label.nextElementSibling as HTMLElement;
}

describe("ShareLinkCreated", () => {
  it("shows the view count", () => {
    renderCreated(baseShare);
    expect(viewsValue()).toHaveTextContent("4");
  });

  it("shows a zero view count rather than leaving it blank", () => {
    renderCreated({ ...baseShare, viewCount: 0 });
    expect(viewsValue()).toHaveTextContent(/^0$/);
  });

  it("labels a frozen report link as frozen", () => {
    renderCreated({
      ...baseShare,
      frozen: {
        capturedAt: "2026-09-20T10:00:00.000Z",
        capturedByName: null,
        rowCount: 1,
        totalRowCount: 1,
        truncated: false,
      },
    });
    expect(screen.getByTestId("share-created-data-mode")).toHaveTextContent(
      "reports.frozen.frozen.title"
    );
  });

  it("labels a report link without a snapshot as live", () => {
    renderCreated(baseShare);
    expect(screen.getByTestId("share-created-data-mode")).toHaveTextContent(
      "reports.frozen.live.title"
    );
  });

  it("omits the data row for non-report shares", () => {
    renderCreated({ ...baseShare, entityType: "SEARCH" });
    expect(screen.queryByTestId("share-created-data-mode")).toBeNull();
    expect(screen.queryByText("common.fields.data")).toBeNull();
  });
});
