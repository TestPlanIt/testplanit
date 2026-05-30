import { describe, expect, it } from "vitest";
import { encodeNdjsonLine, ndjsonResponse, type PageSource } from "./ndjson";

const decoder = new TextDecoder();

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

function pagesFrom<T>(...pages: T[][]): PageSource<T> {
  return (async function* () {
    for (const p of pages) yield p;
  })();
}

describe("encodeNdjsonLine", () => {
  it("serializes a value and appends a single newline", () => {
    const bytes = encodeNdjsonLine({ id: 1, name: "a" });
    expect(decoder.decode(bytes)).toBe('{"id":1,"name":"a"}\n');
  });

  it("handles primitives", () => {
    expect(decoder.decode(encodeNdjsonLine(42))).toBe("42\n");
    expect(decoder.decode(encodeNdjsonLine("hello"))).toBe('"hello"\n');
    expect(decoder.decode(encodeNdjsonLine(null))).toBe("null\n");
  });
});

describe("ndjsonResponse", () => {
  it("emits one line per row across multiple pages", async () => {
    const res = ndjsonResponse({
      pages: pagesFrom([{ id: 1 }, { id: 2 }], [{ id: 3 }]),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/x-ndjson; charset=utf-8"
    );
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = await readAll(res);
    expect(body).toBe('{"id":1}\n{"id":2}\n{"id":3}\n');
  });

  it("emits the manifest as the first line", async () => {
    const res = ndjsonResponse({
      manifest: { type: "manifest", schemaVersion: 1, cursor: null },
      pages: pagesFrom([{ id: 1 }]),
    });
    const lines = (await readAll(res)).split("\n").filter(Boolean);
    expect(JSON.parse(lines[0])).toEqual({
      type: "manifest",
      schemaVersion: 1,
      cursor: null,
    });
    expect(JSON.parse(lines[1])).toEqual({ id: 1 });
  });

  it("skips empty pages without emitting a stray newline", async () => {
    const res = ndjsonResponse({
      pages: pagesFrom([{ id: 1 }], [], [{ id: 2 }]),
    });
    expect(await readAll(res)).toBe('{"id":1}\n{"id":2}\n');
  });

  it("applies the serialize transform when provided", async () => {
    const res = ndjsonResponse<{ id: number; secret: string }>({
      pages: pagesFrom([
        { id: 1, secret: "shh" },
        { id: 2, secret: "shh" },
      ]),
      serialize: (row) => ({ id: row.id }),
    });
    expect(await readAll(res)).toBe('{"id":1}\n{"id":2}\n');
  });

  it("ends the stream with an error line when the source throws", async () => {
    const failing: PageSource<{ id: number }> = (async function* () {
      yield [{ id: 1 }];
      throw new Error("db connection lost");
    })();
    const res = ndjsonResponse({ pages: failing });
    const body = await readAll(res);
    const lines = body.split("\n").filter(Boolean);
    expect(JSON.parse(lines[0])).toEqual({ id: 1 });
    expect(JSON.parse(lines[1])).toEqual({ error: "db connection lost" });
  });

  it("merges caller-provided headers without losing the content type", async () => {
    const res = ndjsonResponse({
      pages: pagesFrom<{ id: number }>(),
      headers: { "X-Manifest-Url": "/api/export/manifest" },
    });
    expect(res.headers.get("content-type")).toBe(
      "application/x-ndjson; charset=utf-8"
    );
    expect(res.headers.get("x-manifest-url")).toBe("/api/export/manifest");
  });

  it("concatenates a page into a single network chunk", async () => {
    const res = ndjsonResponse({
      pages: pagesFrom([{ id: 1 }, { id: 2 }, { id: 3 }]),
    });
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    // One page = one chunk (besides the close signal).
    expect(chunks.length).toBe(1);
    expect(decoder.decode(chunks[0])).toBe('{"id":1}\n{"id":2}\n{"id":3}\n');
  });
});
