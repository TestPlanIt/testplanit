import { describe, expect, it } from "vitest";

import {
  isSlackWebhookUrl,
  SLACK_WEBHOOK_HOSTNAME,
} from "./slack-url-detection";

/**
 * D-29 — Slack incoming-webhook URL hostname detector.
 *
 * Auto-detect rule: hostname is exactly `hooks.slack.com`. Workspace
 * subdomains (e.g. `acme.slack.com`) are NOT incoming webhooks.
 * Slack Enterprise Grid uses the same `hooks.slack.com` hostname.
 */
describe("isSlackWebhookUrl", () => {
  it("exports the hostname constant as 'hooks.slack.com'", () => {
    expect(SLACK_WEBHOOK_HOSTNAME).toBe("hooks.slack.com");
  });

  it.each([
    {
      url: "https://hooks.slack.com/services/T00/B00/abc",
      expected: true,
      label: "canonical Slack incoming webhook URL",
    },
    {
      url: "https://hooks.slack.com/services/",
      expected: true,
      label: "path-agnostic — only hostname matters (D-29)",
    },
    {
      url: "http://hooks.slack.com/services/T/B/C",
      expected: true,
      label: "scheme-agnostic — HTTP-vs-HTTPS validation is the server action's job",
    },
    {
      url: "https://Hooks.SLACK.com/services/T/B/C",
      expected: true,
      label: "URL constructor lowercases hostname (case-insensitive)",
    },
    {
      url: "https://example.com/webhook",
      expected: false,
      label: "non-Slack hostname returns false",
    },
    {
      url: "https://my-workspace.slack.com/services/T/B/C",
      expected: false,
      label: "workspace-subdomained slack.com is NOT an incoming webhook",
    },
    {
      url: "not-a-url",
      expected: false,
      label: "invalid URL returns false (URL constructor throws → caught)",
    },
    {
      url: "",
      expected: false,
      label: "empty string returns false",
    },
    {
      url: null as unknown as string,
      expected: false,
      label: "null returns false (defensive)",
    },
    {
      url: undefined as unknown as string,
      expected: false,
      label: "undefined returns false (defensive)",
    },
  ])("$label", ({ url, expected }) => {
    expect(isSlackWebhookUrl(url)).toBe(expected);
  });
});
