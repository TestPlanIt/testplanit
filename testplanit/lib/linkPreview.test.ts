import { afterEach, describe, expect, it } from "vitest";

import {
  getLinkPreviewMode,
  isLinkPreviewBot,
  matchPreviewRoute,
} from "./linkPreview";

describe("matchPreviewRoute", () => {
  it("classifies record detail routes with their numeric id", () => {
    expect(matchPreviewRoute("/projects/repository/5/1234")).toEqual({
      entity: "test-case",
      id: 1234,
    });
    expect(matchPreviewRoute("/projects/runs/5/88")).toEqual({
      entity: "test-run",
      id: 88,
    });
    expect(matchPreviewRoute("/projects/sessions/5/9")).toEqual({
      entity: "session",
      id: 9,
    });
    expect(matchPreviewRoute("/projects/milestones/5/3")).toEqual({
      entity: "milestone",
      id: 3,
    });
  });

  it("resolves the global record stubs", () => {
    expect(matchPreviewRoute("/case/1234")).toEqual({
      entity: "test-case",
      id: 1234,
    });
    expect(matchPreviewRoute("/milestone/3")).toEqual({
      entity: "milestone",
      id: 3,
    });
  });

  it("resolves sub-routes to their parent record", () => {
    // Test case version history
    expect(matchPreviewRoute("/projects/repository/5/1234/7")).toEqual({
      entity: "test-case",
      id: 1234,
    });
    expect(matchPreviewRoute("/projects/sessions/5/9/2")).toEqual({
      entity: "session",
      id: 9,
    });
  });

  it("previews a project-scoped list page as its project", () => {
    expect(matchPreviewRoute("/projects/overview/5")).toEqual({
      entity: "project",
      id: 5,
    });
    expect(matchPreviewRoute("/projects/runs/5")).toEqual({
      entity: "project",
      id: 5,
    });
    expect(matchPreviewRoute("/projects/repository/5")).toEqual({
      entity: "project",
      id: 5,
    });
  });

  it("falls back to the generic app card rather than returning nothing", () => {
    expect(matchPreviewRoute("/")).toEqual({ entity: "app", id: null });
    expect(matchPreviewRoute("/admin/users")).toEqual({
      entity: "app",
      id: null,
    });
    expect(matchPreviewRoute("/reviews")).toEqual({ entity: "app", id: null });
  });

  it("does not match a non-numeric id segment", () => {
    // Prefixed keys are normalised to numeric ids upstream in proxy.ts, so a
    // surviving non-numeric segment is not a record we can preview.
    expect(matchPreviewRoute("/projects/repository/5/PROJECT-TC-1234")).toEqual(
      {
        entity: "project",
        id: 5,
      }
    );
  });

  it("rejects ids that are not safe positive integers", () => {
    expect(matchPreviewRoute("/projects/runs/5/0")).toEqual({
      entity: "test-run",
      id: null,
    });
    expect(matchPreviewRoute("/projects/runs/5/99999999999999999999")).toEqual({
      entity: "test-run",
      id: null,
    });
  });
});

describe("isLinkPreviewBot", () => {
  it("detects the chat and social unfurlers", () => {
    const agents = [
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
      "Twitterbot/1.0",
      "facebookexternalhit/1.1",
      "LinkedInBot/1.0 (compatible; Mozilla/5.0)",
      "TelegramBot (like TwitterBot)",
      "WhatsApp/2.19.81 A",
      "Mozilla/5.0 (compatible; SkypeUriPreview Preview/0.5)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "Mozilla/5.0 (compatible) AppleBot/0.1",
    ];
    for (const agent of agents) {
      expect(isLinkPreviewBot(agent), agent).toBe(true);
    }
  });

  it("leaves real browsers on the normal sign-in redirect", () => {
    const agents = [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    ];
    for (const agent of agents) {
      expect(isLinkPreviewBot(agent), agent).toBe(false);
    }
  });

  it("treats a missing user agent as a browser", () => {
    expect(isLinkPreviewBot(null)).toBe(false);
    expect(isLinkPreviewBot(undefined)).toBe(false);
    expect(isLinkPreviewBot("")).toBe(false);
  });
});

describe("getLinkPreviewMode", () => {
  const original = process.env.LINK_PREVIEW_MODE;

  afterEach(() => {
    if (original === undefined) delete process.env.LINK_PREVIEW_MODE;
    else process.env.LINK_PREVIEW_MODE = original;
  });

  it("defaults to safe so record names never leak by accident", () => {
    delete process.env.LINK_PREVIEW_MODE;
    expect(getLinkPreviewMode()).toBe("safe");

    process.env.LINK_PREVIEW_MODE = "";
    expect(getLinkPreviewMode()).toBe("safe");

    process.env.LINK_PREVIEW_MODE = "true";
    expect(getLinkPreviewMode()).toBe("safe");
  });

  it("opts into names only on the exact value", () => {
    process.env.LINK_PREVIEW_MODE = "names";
    expect(getLinkPreviewMode()).toBe("names");
  });
});
