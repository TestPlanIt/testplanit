import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
