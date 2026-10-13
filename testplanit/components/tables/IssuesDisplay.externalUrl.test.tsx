import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

/**
 * `externalUrl` is tracker-provided and some sync paths write it through the
 * raw db client, bypassing the schema's `@url` validation — so a badge must
 * never turn a non-http(s) value into a clickable link, and must still link
 * the http(s) ones.
 */

vi.stubGlobal("fetch", vi.fn());

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

vi.mock("~/hooks/useIssueUpdateStream", () => ({
  useIssueUpdateStream: () => undefined,
}));

vi.mock("@/hooks/useIssueColors", () => ({
  useIssueColors: () => ({
    getStatusColor: () => "#888",
    getPriorityColor: () => "#888",
    getPriorityStyle: () => ({}),
  }),
}));

import { IssuesDisplay } from "./IssuesDisplay";

function anchorsIn(container: HTMLElement): HTMLAnchorElement[] {
  return Array.from(container.querySelectorAll("a[href]"));
}

describe("IssuesDisplay — external URL safety", () => {
  it.each([
    ["javascript:alert(1)"],
    ["JaVaScRiPt:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["vbscript:msgbox(1)"],
  ])("never renders %s as a link", (hostileUrl) => {
    const { container } = render(
      <IssuesDisplay
        id={5001}
        name="PROJ-9"
        externalId="PROJ-9"
        externalUrl={hostileUrl}
        title="Hostile"
        integrationProvider="GITHUB"
        integrationId={3}
        projectIds={[1]}
      />
    );

    expect(anchorsIn(container)).toHaveLength(0);
    // The row still renders — the text is shown, just not as a destination.
    expect(screen.getByText("PROJ-9: Hostile")).toBeInTheDocument();
  });

  it("links an http(s) externalUrl", () => {
    const { container } = render(
      <IssuesDisplay
        id={5002}
        name="PROJ-10"
        externalId="PROJ-10"
        externalUrl="https://example.com/browse/PROJ-10"
        title="Real"
        integrationProvider="GITHUB"
        integrationId={3}
        projectIds={[1]}
      />
    );

    const hrefs = anchorsIn(container).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://example.com/browse/PROJ-10");
  });

  it("links an http(s) externalUrl even with no integration provider", () => {
    const { container } = render(
      <IssuesDisplay
        id={5003}
        name="PROJ-11"
        externalUrl="https://example.com/browse/PROJ-11"
        title="Orphaned"
        projectIds={[1]}
      />
    );

    const hrefs = anchorsIn(container).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://example.com/browse/PROJ-11");
  });

  it("renders an internal issue with no link at all", () => {
    const { container } = render(
      <IssuesDisplay id={5004} name="Internal defect" projectIds={[1]} />
    );

    expect(anchorsIn(container)).toHaveLength(0);
    expect(screen.getByText("Internal defect")).toBeInTheDocument();
  });

  it("does not nest an anchor inside the badge's own anchor", () => {
    const { container } = render(
      <IssuesDisplay
        id={5005}
        name="PROJ-12"
        externalUrl="https://example.com/browse/PROJ-12"
        title="Nested"
        integrationProvider="GITHUB"
        integrationId={3}
        projectIds={[1]}
      />
    );

    for (const anchor of anchorsIn(container)) {
      expect(anchor.querySelector("a")).toBeNull();
    }
  });
});
