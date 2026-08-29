import { describe, expect, it } from "vitest";
import { buildCommentsWhere, commentSearchText } from "./UserComments";

describe("buildCommentsWhere", () => {
  const userId = "user-1";

  it("matches authored and mentioned comments for the all scope", () => {
    expect(buildCommentsWhere(userId, "all")).toEqual({
      isDeleted: false,
      OR: [{ creatorId: userId }, { mentionedUsers: { some: { userId } } }],
    });
  });

  it("matches only mentions for the mentioned scope", () => {
    expect(buildCommentsWhere(userId, "mentioned")).toEqual({
      isDeleted: false,
      mentionedUsers: { some: { userId } },
    });
  });

  it("matches only the user's own comments for the authored scope", () => {
    expect(buildCommentsWhere(userId, "authored")).toEqual({
      isDeleted: false,
      creatorId: userId,
    });
  });
});

describe("commentSearchText", () => {
  it("flattens nested Tiptap text nodes to lowercase", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Login FAILS on " },
            { type: "text", text: "Safari" },
          ],
        },
      ],
    };
    expect(commentSearchText(doc)).toBe("login fails on  safari");
  });

  it("includes mention chip labels so names are searchable", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "mention", attrs: { id: "u2", label: "Riley Jensen" } },
            { type: "text", text: " please review" },
          ],
        },
      ],
    };
    expect(commentSearchText(doc)).toContain("riley jensen");
    expect(commentSearchText(doc)).toContain("please review");
  });

  it("parses stringified documents", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
    });
    expect(commentSearchText(doc)).toBe("hi");
  });

  it("returns plain strings lowercased when content is not JSON", () => {
    expect(commentSearchText("Plain Note")).toBe("plain note");
  });

  it("returns an empty string for null or malformed content", () => {
    expect(commentSearchText(null)).toBe("");
    expect(commentSearchText(42)).toBe("");
    expect(commentSearchText({ type: "doc" })).toBe("");
  });
});
