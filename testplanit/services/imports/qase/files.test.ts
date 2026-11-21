import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QaseFileCopier } from "./files";

const response = (body: string, init: ResponseInit = {}) =>
  new Response(body, { status: 200, ...init });

describe("QaseFileCopier", () => {
  beforeEach(() => {
    vi.stubEnv("AWS_BUCKET_NAME", "bucket");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const build = (
    fetchImpl: typeof fetch,
    lookup: (host: string) => Promise<string[]> = async () => ["93.184.216.34"]
  ) => {
    const upload = vi.fn(async () => {});
    const onCopied = vi.fn(async () => {});
    const copier = new QaseFileCopier({
      jobId: "job1",
      fetchImpl,
      lookup,
      upload,
      onCopied,
      retryDelayMs: 0,
    });
    return { copier, upload, onCopied };
  };

  it("uploads a file once and reuses the copy", async () => {
    const fetchImpl = vi.fn(async () =>
      response("hello", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    ) as unknown as typeof fetch;
    const { copier, upload, onCopied } = build(fetchImpl);
    const first = await copier.copy(
      "attachment",
      "https://files.test/a.txt",
      "a b.txt"
    );
    const second = await copier.copy(
      "attachment",
      "https://files.test/a.txt",
      "a b.txt"
    );
    expect(first).toEqual(second);
    expect(first?.size).toBe(5);
    expect(first?.mime).toBe("text/plain");
    expect(first?.url).toMatch(
      /^\/api\/storage\/uploads\/attachments\/qase_job1_\d+_1_a_b\.txt$/
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(onCopied).toHaveBeenCalledWith(
      "attachment:https://files.test/a.txt",
      first
    );
  });

  it("refuses private addresses, plain http and non-images for inline images", async () => {
    const fetchImpl = vi.fn(async () =>
      response("x", { headers: { "content-type": "text/plain" } })
    ) as unknown as typeof fetch;
    const privateHost = build(fetchImpl, async () => ["10.0.0.5"]);
    expect(
      await privateHost.copier.copy(
        "attachment",
        "https://internal.test/a",
        "a"
      )
    ).toBeNull();
    expect(
      privateHost.copier.failureOf("attachment", "https://internal.test/a")
    ).toMatch(/private/);
    expect(fetchImpl).not.toHaveBeenCalled();

    const { copier, upload } = build(fetchImpl);
    expect(
      await copier.copy("attachment", "http://files.test/a", "a")
    ).toBeNull();
    expect(
      await copier.copy("docimage", "https://files.test/a.txt", "a.txt")
    ).toBeNull();
    expect(copier.failureOf("docimage", "https://files.test/a.txt")).toMatch(
      /not an image/
    );
    expect(upload).not.toHaveBeenCalled();
  });

  it("checks a redirect's destination and remembers a failure", async () => {
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) =>
      String(input).includes("start")
        ? response("", {
            status: 302,
            headers: { location: "https://internal.test/x" },
          })
        : response("secret")
    ) as unknown as typeof fetch;
    const lookup = async (host: string) =>
      host === "internal.test" ? ["127.0.0.1"] : ["93.184.216.34"];
    const { copier } = build(fetchImpl, lookup);
    expect(
      await copier.copy("attachment", "https://files.test/start", "a")
    ).toBeNull();
    expect(
      await copier.copy("attachment", "https://files.test/start", "a")
    ).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not download when storage is not set up", async () => {
    vi.stubEnv("AWS_BUCKET_NAME", "");
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { copier } = build(fetchImpl);
    expect(
      await copier.copy("attachment", "https://files.test/a", "a")
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("tries a dropped or busy download again before giving up", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(response("busy", { status: 503 }))
      .mockResolvedValueOnce(response("hello")) as unknown as typeof fetch;
    const { copier, upload } = build(fetchImpl);

    const copied = await copier.copy(
      "attachment",
      "https://files.test/a.txt",
      "a.txt"
    );

    expect(copied?.size).toBe(5);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("gives up after three failed attempts and does not ask again", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const { copier, upload } = build(fetchImpl);

    expect(
      await copier.copy("attachment", "https://files.test/a.txt", "a.txt")
    ).toBeNull();
    expect(
      await copier.copy("attachment", "https://files.test/a.txt", "a.txt")
    ).toBeNull();

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(copier.failureOf("attachment", "https://files.test/a.txt")).toBe(
      "fetch failed"
    );
    expect(upload).not.toHaveBeenCalled();
  });

  it("does not repeat a download the host refuses", async () => {
    const fetchImpl = vi.fn(async () =>
      response("gone", { status: 404 })
    ) as unknown as typeof fetch;
    const { copier } = build(fetchImpl);

    expect(
      await copier.copy("attachment", "https://files.test/a.txt", "a.txt")
    ).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
