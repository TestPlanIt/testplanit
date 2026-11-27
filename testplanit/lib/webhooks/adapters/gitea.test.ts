import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { giteaAdapter } from "./gitea";

const SECRET = "test-secret-do-not-use-in-prod";

/** The bare hex digest Gitea itself puts in `X-Gitea-Signature`. */
function signBody(body: Buffer | string, secret: string): string {
  const buf = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  return createHmac("sha256", secret).update(buf).digest("hex");
}

function bodyOf(obj: unknown): Buffer {
  return Buffer.from(JSON.stringify(obj), "utf8");
}

function headersOf(init: Record<string, string>): Headers {
  return new Headers(init);
}

const CANONICAL_PAYLOAD = {
  action: "closed",
  number: 42,
  issue: {
    number: 42,
    state: "closed",
    title: "Fix bug",
    milestone: null,
  },
  repository: { full_name: "acme/app" },
};

function verified(event: string, payload: unknown) {
  const body = bodyOf(payload);
  const result = giteaAdapter.verify(
    body,
    headersOf({
      "x-gitea-signature": signBody(body, SECRET),
      "x-gitea-event": event,
    }),
    SECRET
  );
  if (!result.valid) throw new Error(`unexpected ${result.reason}`);
  return result.payload;
}

describe("giteaAdapter — verify", () => {
  it("exposes adapterType === 'GITEA'", () => {
    expect(giteaAdapter.adapterType).toBe("GITEA");
  });

  it("rejects a delivery without a signature header", () => {
    const body = bodyOf(CANONICAL_PAYLOAD);
    expect(
      giteaAdapter.verify(
        body,
        headersOf({ "x-gitea-event": "issues" }),
        SECRET
      )
    ).toEqual({ valid: false, reason: "missing-signature" });
  });

  it("accepts the bare hex digest Gitea sends", () => {
    const body = bodyOf(CANONICAL_PAYLOAD);
    const result = giteaAdapter.verify(
      body,
      headersOf({
        "x-gitea-signature": signBody(body, SECRET),
        "x-gitea-event": "issues",
      }),
      SECRET
    );

    expect(result).toEqual({
      valid: true,
      payload: {
        eventType: "issues",
        issueKey: "acme/app#42",
        externalStatus: "closed",
        synthetic: false,
        data: CANONICAL_PAYLOAD,
      },
    });
  });

  it("accepts the same digest with a sha256= prefix, in any letter case", () => {
    const body = bodyOf(CANONICAL_PAYLOAD);
    const digest = signBody(body, SECRET);
    for (const signature of [`sha256=${digest}`, digest.toUpperCase()]) {
      const result = giteaAdapter.verify(
        body,
        headersOf({
          "x-gitea-signature": signature,
          "x-gitea-event": "issues",
        }),
        SECRET
      );
      expect(result.valid).toBe(true);
    }
  });

  it("rejects a signature that is not a 64-character hex digest", () => {
    const body = bodyOf(CANONICAL_PAYLOAD);
    for (const signature of [
      "sha256=nothex",
      "abc123",
      "sha1=" + "a".repeat(40),
    ]) {
      expect(
        giteaAdapter.verify(
          body,
          headersOf({
            "x-gitea-signature": signature,
            "x-gitea-event": "issues",
          }),
          SECRET
        )
      ).toEqual({ valid: false, reason: "malformed-signature" });
    }
  });

  it("rejects a digest made with another secret or over another body", () => {
    const body = bodyOf(CANONICAL_PAYLOAD);
    for (const signature of [
      signBody(body, "another-secret"),
      signBody(bodyOf({ ...CANONICAL_PAYLOAD, action: "reopened" }), SECRET),
    ]) {
      expect(
        giteaAdapter.verify(
          body,
          headersOf({
            "x-gitea-signature": signature,
            "x-gitea-event": "issues",
          }),
          SECRET
        )
      ).toEqual({ valid: false, reason: "signature-mismatch" });
    }
  });

  it("rejects a signed delivery without an event header", () => {
    const body = bodyOf(CANONICAL_PAYLOAD);
    expect(
      giteaAdapter.verify(
        body,
        headersOf({ "x-gitea-signature": signBody(body, SECRET) }),
        SECRET
      )
    ).toEqual({ valid: false, reason: "missing-required-field" });
  });

  it("rejects a signed body that is not JSON", () => {
    const body = Buffer.from("not json", "utf8");
    expect(
      giteaAdapter.verify(
        body,
        headersOf({
          "x-gitea-signature": signBody(body, SECRET),
          "x-gitea-event": "issues",
        }),
        SECRET
      )
    ).toEqual({ valid: false, reason: "unparseable-body" });
  });

  it("flags only the self-test payload as synthetic", () => {
    expect(
      verified("issues", {
        action: "opened",
        issue: { number: 0, state: "open", title: "Synthetic test" },
        repository: { full_name: "__synthetic__/__synthetic__" },
      }).synthetic
    ).toBe(true);
    expect(
      verified("issues", {
        action: "opened",
        issue: { number: 0, state: "open" },
        repository: { full_name: "acme/app" },
      }).synthetic
    ).toBe(false);
    expect(
      verified("issues", {
        action: "opened",
        issue: { number: 3, state: "open" },
        repository: { full_name: "__synthetic__/__synthetic__" },
      }).synthetic
    ).toBe(false);
  });
});

describe("giteaAdapter — extractLinkedIssueRef and extractExternalStatus", () => {
  it("returns the issue's key and number", () => {
    expect(giteaAdapter.extractLinkedIssueRef(CANONICAL_PAYLOAD)).toEqual({
      externalKey: "acme/app#42",
      externalSystem: "GITEA",
      externalId: "42",
    });
  });

  it("returns no ref without a repository or an issue number", () => {
    expect(
      giteaAdapter.extractLinkedIssueRef({ issue: { number: 42 } })
    ).toBeNull();
    expect(
      giteaAdapter.extractLinkedIssueRef({
        repository: { full_name: "acme/app" },
      })
    ).toBeNull();
  });

  it("returns the issue state for an issues event only", () => {
    const payload = verified("issues", CANONICAL_PAYLOAD);
    expect(giteaAdapter.extractExternalStatus(payload, "issues")).toBe(
      "closed"
    );
    expect(
      giteaAdapter.extractExternalStatus(payload, "issue_comment")
    ).toBeNull();
    expect(
      giteaAdapter.extractExternalStatus(payload, "milestone_milestoned")
    ).toBeNull();
  });
});

describe("giteaAdapter — milestone events", () => {
  const REPO = { full_name: "acme/app" };

  it("routes an issue joining a milestone to milestone sync, with that milestone", () => {
    const payload = verified("issues", {
      action: "milestoned",
      number: 7,
      issue: {
        number: 7,
        state: "open",
        milestone: { id: 31, title: "1.0", state: "open" },
      },
      repository: REPO,
    });

    expect(payload.eventType).toBe("milestone_milestoned");
    expect(payload.issueKey).toBe("acme/app#7");
    expect(payload.synthetic).toBe(false);
    expect(
      giteaAdapter.extractMilestoneEventRef!(payload, payload.eventType)
    ).toEqual({
      kind: "RELEASE",
      externalId: "acme/app#31",
      externalProjectId: "acme/app",
      merge: false,
    });
  });

  it("leaves an issue leaving its milestone on the issue path: the payload names no milestone", () => {
    const payload = verified("issues", {
      action: "demilestoned",
      number: 7,
      issue: { number: 7, state: "open", milestone: null },
      repository: REPO,
    });

    expect(payload.eventType).toBe("issues");
    expect(
      giteaAdapter.extractMilestoneEventRef!(payload, payload.eventType)
    ).toBeNull();
    expect(giteaAdapter.extractExternalStatus(payload, payload.eventType)).toBe(
      "open"
    );
  });

  it("leaves other issue actions on the issue path, even on an issue in a milestone", () => {
    for (const action of ["opened", "edited", "closed", "label_updated"]) {
      const payload = verified("issues", {
        action,
        issue: { number: 7, state: "open", milestone: { id: 31 } },
        repository: REPO,
      });
      expect(payload.eventType).toBe("issues");
    }
  });

  it("leaves a milestoned action on another event on its own path", () => {
    const payload = verified("pull_request", {
      action: "milestoned",
      issue: { number: 7, state: "open", milestone: { id: 31 } },
      repository: REPO,
    });
    expect(payload.eventType).toBe("pull_request");
  });

  it("returns no ref for a milestone event without a repository", () => {
    expect(
      giteaAdapter.extractMilestoneEventRef!(
        { action: "milestoned", issue: { number: 7, milestone: { id: 31 } } },
        "milestone_milestoned"
      )
    ).toBeNull();
  });
});
