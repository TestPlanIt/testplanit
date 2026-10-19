import { describe, expect, it } from "vitest";
import {
  fingerprintFailure,
  normalizeMessage,
  shortenPath,
} from "./fingerprint";

const wdioNotFound = (stamp: number, line: number) => ({
  repositoryCaseId: 98860,
  message: `Can't call waitAndClick on element with selector "li=Automated testuser ${stamp}" because element wasn't found`,
  content: `Error: Can't call waitAndClick on element with selector "li=Automated testuser ${stamp}" because element wasn't found\n    at async Context.<anonymous> (/Users/bdermanouelian/git/wdio/src/web/test/specs/admin/Manage Collection/anyRecipientFilter.ts:${line}:4)`,
});

describe("fingerprintFailure", () => {
  it("groups the same WDIO failure across runs despite timestamps and line drift", () => {
    const a = fingerprintFailure(wdioNotFound(1765729664090, 83));
    const b = fingerprintFailure(wdioNotFound(1765746595812, 83));
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.kind).toBe("stack");
    expect(a.exceptionType).toBe("Error");
    expect(a.normalizedMessage).toBe(
      `Can't call waitAndClick on element with selector "li=Automated testuser <n>" because element wasn't found`
    );
    expect(a.frames).toEqual([
      "Context.<anonymous> (admin/Manage Collection/anyRecipientFilter.ts)",
    ]);
    expect(a.title).toBe(`Error: ${a.normalizedMessage}`);
  });

  it("keeps the same failure at a different call site apart", () => {
    const a = fingerprintFailure(wdioNotFound(1, 83));
    const b = fingerprintFailure({
      ...wdioNotFound(1, 137),
      content: wdioNotFound(1, 137).content.replace(
        "anyRecipientFilter.ts",
        "bulkOperations.ts"
      ),
    });
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it("falls back to a per-case fingerprint when the result has no details", () => {
    const a = fingerprintFailure({ repositoryCaseId: 70128 });
    const b = fingerprintFailure({
      repositoryCaseId: 70128,
      message: "",
      content: null,
    });
    const c = fingerprintFailure({ repositoryCaseId: 70129 });
    expect(a.kind).toBe("none");
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
    expect(a.title).toBe("");
    expect(a.exceptionType).toBeNull();
  });

  it("uses the message alone when there is no stack", () => {
    const a = fingerprintFailure({
      repositoryCaseId: 6948,
      message: "AssertionError: expected 200 to equal 500",
    });
    const b = fingerprintFailure({
      repositoryCaseId: 6948,
      message: "AssertionError: expected 404 to equal 200",
    });
    expect(a.kind).toBe("message");
    expect(a.exceptionType).toBe("AssertionError");
    expect(a.normalizedMessage).toBe("expected <n> to equal <n>");
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("parses a JUnit / JVM failure and skips framework frames", () => {
    const content = [
      "org.opentest4j.AssertionFailedError: expected: <3> but was: <4>",
      "\tat org.junit.jupiter.api.AssertionUtils.fail(AssertionUtils.java:55)",
      "\tat org.junit.jupiter.api.AssertEquals.failNotEqual(AssertEquals.java:195)",
      "\tat com.acme.cart.CartServiceTest.addsItems(CartServiceTest.java:42)",
      "\tat java.base/jdk.internal.reflect.NativeMethodAccessorImpl.invoke0(Native Method)",
    ].join("\n");
    const fp = fingerprintFailure({
      repositoryCaseId: 1,
      message: "expected: <3> but was: <4>",
      content,
    });
    expect(fp.exceptionType).toBe("AssertionFailedError");
    expect(fp.normalizedMessage).toBe("expected: <<n>> but was: <<n>>");
    expect(fp.frames).toEqual([
      "com.acme.cart.CartServiceTest.addsItems(CartServiceTest.java)",
    ]);
  });

  it("parses a pytest traceback, taking the last exception line", () => {
    const content = [
      "Traceback (most recent call last):",
      '  File "/home/runner/work/app/tests/test_orders.py", line 31, in test_total',
      "    assert order.total == 10",
      '  File "/usr/lib/python3.12/site-packages/_pytest/assertion/rewrite.py", line 10, in _call',
      "AssertionError: assert 9.5 == 10",
    ].join("\n");
    const fp = fingerprintFailure({ repositoryCaseId: 1, content });
    expect(fp.exceptionType).toBe("AssertionError");
    expect(fp.normalizedMessage).toBe("assert <n> == <n>");
    expect(fp.frames).toEqual(["test_total (app/tests/test_orders.py)"]);
  });

  it("parses a .NET / NUnit failure", () => {
    const content = [
      "NUnit.Framework.AssertionException :   Expected: 5",
      "  But was:  6",
      "   at NUnit.Framework.Assert.That(Object actual, IResolveConstraint expression)",
      "   at Acme.Tests.InvoiceTests.Sums() in C:\\src\\acme\\tests\\InvoiceTests.cs:line 27",
    ].join("\n");
    const fp = fingerprintFailure({ repositoryCaseId: 1, content });
    expect(fp.exceptionType).toBe("AssertionException");
    expect(fp.normalizedMessage).toBe("Expected: <n>");
    expect(fp.frames).toEqual([
      "Acme.Tests.InvoiceTests.Sums() (acme/tests/InvoiceTests.cs)",
    ]);
  });

  it("parses a Playwright timeout with frames outside node_modules", () => {
    const content = [
      "TimeoutError: locator.click: Timeout 30000ms exceeded.",
      "Call log:",
      "  - waiting for getByRole('button', { name: 'Save' })",
      "    at /home/runner/work/web/e2e/tests/settings/profile.spec.ts:48:37",
      "    at /home/runner/work/web/node_modules/@playwright/test/lib/worker.js:10:5",
    ].join("\n");
    const fp = fingerprintFailure({
      repositoryCaseId: 1,
      message: "locator.click: Timeout 30000ms exceeded.",
      content,
    });
    expect(fp.exceptionType).toBe("TimeoutError");
    expect(fp.normalizedMessage).toBe("locator.click: Timeout <n>ms exceeded.");
    expect(fp.frames).toEqual(["tests/settings/profile.spec.ts"]);
  });

  it("keeps a message with no recognizable type", () => {
    const fp = fingerprintFailure({
      repositoryCaseId: 1,
      message: "expect(received).toBe(expected)\n\nExpected: 2\nReceived: 3",
    });
    expect(fp.exceptionType).toBeNull();
    expect(fp.normalizedMessage).toBe("expect(received).toBe(expected)");
    expect(fp.kind).toBe("message");
  });

  it("reads systemErr when message and content are empty", () => {
    const fp = fingerprintFailure({
      repositoryCaseId: 1,
      systemErr: "FATAL: connection refused to db-7 (attempt 3)",
    });
    expect(fp.kind).toBe("message");
    expect(fp.normalizedMessage).toBe(
      "FATAL: connection refused to db-<n> (attempt <n>)"
    );
  });

  it("truncates long titles", () => {
    const fp = fingerprintFailure({
      repositoryCaseId: 1,
      message: `Error: ${"x".repeat(600)}`,
    });
    expect(fp.title.length).toBeLessThanOrEqual(200);
    expect(fp.title.endsWith("…")).toBe(true);
  });
});

describe("normalizeMessage", () => {
  it("masks urls, emails, uuids, timestamps, paths and hex ids", () => {
    expect(
      normalizeMessage(
        "GET https://api.acme.test/v1/users/42 for bob@acme.test id 3fa85f64-5717-4562-b3fc-2c963f66afa6 at 2026-10-18T11:03:00Z from /tmp/run-12/out.log ref 0xdeadbeef token a1b2c3d4e5f60718"
      )
    ).toBe(
      "GET <url> for <email> id <uuid> at <ts> from <path> ref <hex> token <hex>"
    );
  });

  it("collapses whitespace", () => {
    expect(normalizeMessage("  a \n\n b\t c ")).toBe("a b c");
  });
});

describe("shortenPath", () => {
  it("keeps the last three segments across path styles", () => {
    expect(shortenPath("/Users/me/git/app/src/web/test/specs/x.ts")).toBe(
      "test/specs/x.ts"
    );
    expect(shortenPath("C:\\src\\acme\\tests\\InvoiceTests.cs")).toBe(
      "acme/tests/InvoiceTests.cs"
    );
    expect(shortenPath("file:///home/ci/e2e/a.spec.ts?x=1")).toBe(
      "ci/e2e/a.spec.ts"
    );
    expect(shortenPath("x.ts")).toBe("x.ts");
  });
});
