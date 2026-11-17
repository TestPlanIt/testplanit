import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  recordCspViolation,
  resetCspBlocks,
} from "~/lib/utils/cspBlockedOrigins";
import type { Attachments } from "~/zenstack/models";
import { AttachmentPreview } from "./AttachmentPreview";

vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("~/utils/storageUrl", () => ({
  getStorageUrlClient: vi.fn((url: string) => url),
}));

vi.mock("@/components/LinkFavicon", () => ({
  LinkFavicon: () => null,
}));

vi.mock("@/components/OfficeDocumentPreview", () => ({
  OfficeDocumentPreview: () => null,
}));

const videoAttachment = {
  id: 1,
  name: "failure.webm",
  url: "https://storage.example.com/failure.webm",
  mimeType: "video/webm",
  size: BigInt(1024),
} as unknown as Attachments;

// The preview stays on a spinner until a detached <video> fires
// onloadeddata, which jsdom never does on its own.
let probes: HTMLVideoElement[] = [];

async function renderVideo(size?: "small" | "medium" | "large" | "full") {
  const result = render(
    <AttachmentPreview attachment={videoAttachment} size={size} />
  );
  await act(async () => {
    probes.forEach((probe) => probe.onloadeddata?.(new Event("loadeddata")));
  });
  return result;
}

describe("AttachmentPreview video", () => {
  beforeEach(() => {
    probes = [];
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(
      (tagName: string, options?: ElementCreationOptions) => {
        const el = createElement(tagName, options);
        if (tagName === "video") probes.push(el as HTMLVideoElement);
        return el;
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the small size as a click-through thumbnail without controls", async () => {
    const { container } = await renderVideo("small");

    expect(
      screen.getByTestId("attachment-video-thumbnail")
    ).toBeInTheDocument();
    const video = container.querySelector("video")!;
    expect(video).not.toHaveAttribute("controls");
    expect(video).toHaveClass("pointer-events-none");
  });

  it.each(["medium", "large", "full"] as const)(
    "keeps native controls for the %s size",
    async (size) => {
      const { container } = await renderVideo(size);

      expect(
        screen.queryByTestId("attachment-video-thumbnail")
      ).not.toBeInTheDocument();
      const video = container.querySelector("video")!;
      expect(video).toHaveAttribute("controls");
      expect(video).not.toHaveClass("pointer-events-none");
    }
  );
});

describe("AttachmentPreview on a host the policy blocks", () => {
  const blockedHost = "https://old-bucket.example.com";

  const attachmentOf = (name: string, mimeType: string) =>
    ({
      id: 2,
      name,
      url: `${blockedHost}/uploads/${name}`,
      mimeType,
      size: BigInt(1024),
    }) as unknown as Attachments;

  function reportBlock() {
    recordCspViolation({
      blockedURI: `${blockedHost}/uploads/other-file`,
      disposition: "enforce",
      effectiveDirective: "frame-src",
    });
  }

  beforeEach(() => {
    resetCspBlocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch")))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replaces a framed PDF with the reason and a download link", async () => {
    const { container } = render(
      <AttachmentPreview
        attachment={attachmentOf("report.pdf", "application/pdf")}
        size="large"
      />
    );
    await act(async () => {});
    expect(container.querySelector("iframe")).toBeInTheDocument();

    await act(async () => reportBlock());

    expect(container.querySelector("iframe")).not.toBeInTheDocument();
    expect(screen.getByText("attachments.preview.blocked")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `${blockedHost}/uploads/report.pdf`
    );
  });

  it("says why a text file has no content", async () => {
    reportBlock();
    render(
      <AttachmentPreview
        attachment={attachmentOf("notes.txt", "text/plain")}
        size="large"
      />
    );
    await act(async () => {});

    expect(screen.getByText("attachments.preview.blocked")).toBeInTheDocument();
  });

  it("shows only the icon and name at the small size", async () => {
    reportBlock();
    render(
      <AttachmentPreview
        attachment={attachmentOf("report.pdf", "application/pdf")}
      />
    );
    await act(async () => {});

    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(
      screen.queryByText("attachments.preview.blocked")
    ).not.toBeInTheDocument();
  });

  it("leaves an image on that host alone", async () => {
    reportBlock();
    const { container } = render(
      <AttachmentPreview
        attachment={attachmentOf("shot.png", "image/png")}
        size="large"
      />
    );
    await act(async () => {});

    expect(
      screen.queryByText("attachments.preview.blocked")
    ).not.toBeInTheDocument();
    expect(container.querySelector("iframe")).not.toBeInTheDocument();
  });
});
