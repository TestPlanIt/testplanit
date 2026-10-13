import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bitbucketAdapter } from "./bitbucket";

const SECRET = "s3cret";
const body = Buffer.from(JSON.stringify({ push: { changes: [] } }));
function sign(buf: Buffer, secret = SECRET) {
  return `sha256=${createHmac("sha256", secret).update(buf).digest("hex")}`;
}
function headers(entries: Record<string, string>) {
  return new Headers(entries);
}

describe("bitbucketAdapter.verify", () => {
  it("accepts a correctly signed delivery and names the event from X-Event-Key", () => {
    const result = bitbucketAdapter.verify(
      body,
      headers({ "x-hub-signature": sign(body), "x-event-key": "repo:push" }),
      SECRET
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.eventType).toBe("repo:push");
      expect(result.payload.data).toEqual({ push: { changes: [] } });
      expect(result.payload.issueKey).toBe("");
    }
  });

  it("rejects a missing, malformed, or mismatched signature", () => {
    expect(
      bitbucketAdapter.verify(
        body,
        headers({ "x-event-key": "repo:push" }),
        SECRET
      )
    ).toMatchObject({ valid: false, reason: "missing-signature" });
    expect(
      bitbucketAdapter.verify(
        body,
        headers({ "x-hub-signature": "md5=abc", "x-event-key": "repo:push" }),
        SECRET
      )
    ).toMatchObject({ valid: false, reason: "malformed-signature" });
    expect(
      bitbucketAdapter.verify(
        body,
        headers({
          "x-hub-signature": sign(body, "other"),
          "x-event-key": "repo:push",
        }),
        SECRET
      )
    ).toMatchObject({ valid: false, reason: "signature-mismatch" });
  });

  it("requires the event header and a JSON body", () => {
    expect(
      bitbucketAdapter.verify(
        body,
        headers({ "x-hub-signature": sign(body) }),
        SECRET
      )
    ).toMatchObject({ valid: false, reason: "missing-required-field" });
    const junk = Buffer.from("{nope");
    expect(
      bitbucketAdapter.verify(
        junk,
        headers({ "x-hub-signature": sign(junk), "x-event-key": "repo:push" }),
        SECRET
      )
    ).toMatchObject({ valid: false, reason: "unparseable-body" });
  });

  it("has no issue-tracker extraction", () => {
    expect(bitbucketAdapter.extractLinkedIssueRef({} as any)).toBeNull();
    expect(bitbucketAdapter.extractExternalStatus({}, "repo:push")).toBeNull();
  });
});
