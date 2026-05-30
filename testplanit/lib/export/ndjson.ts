/**
 * NDJSON streaming response helpers for bulk export endpoints.
 *
 * NDJSON (Newline Delimited JSON) is the lingua franca of data-lake ingestion:
 * Spark, Snowflake, BigQuery, Databricks, and most ETL pipelines consume it
 * line-by-line, which means the consumer never has to materialize the whole
 * response in memory. Pair this with `Transfer-Encoding: chunked` and a paged
 * database cursor and the server side never holds more than one page of rows
 * in memory either, regardless of how many rows the export ultimately produces.
 *
 * Two helpers are exposed:
 *
 * - `ndjsonResponse({ pages, manifest })` — builds a `Response` whose body is
 *   the NDJSON stream. `pages` is an async iterable of row pages; the helper
 *   serializes each row to a line, joins them with `\n`, and flushes one page
 *   per chunk. `manifest` is an optional object emitted as the first line, so
 *   consumers can read schema/version/cursor without parsing every record.
 *
 * - `encodeNdjsonLine(value)` — serializes a single value to a `\n`-terminated
 *   UTF-8 line. Useful when callers want to drive the stream themselves.
 *
 * Error handling: if the row source throws mid-stream, the helper appends a
 * final line `{"error":"..."}` and closes the stream. This is intentional —
 * NDJSON has no envelope, so partial results are valid; we just need to give
 * the consumer a clear "this stopped early" marker rather than silently
 * truncating.
 */

const encoder = new TextEncoder();

/** A page of rows produced by a paged database cursor. */
export type RowPage<T> = readonly T[];

/** Async iterable of row pages — what the route hands to `ndjsonResponse`. */
export type PageSource<T> = AsyncIterable<RowPage<T>>;

export interface NdjsonResponseInit<T> {
  /** Async iterable yielding one page of rows at a time. */
  pages: PageSource<T>;
  /**
   * Optional first-line manifest (schema, generated-at, cursor sentinel).
   * Emitted before any row pages so consumers can branch on it.
   */
  manifest?: Record<string, unknown>;
  /** Per-row transform; defaults to identity. Useful for column projection. */
  serialize?: (row: T) => unknown;
  /** Additional response headers merged onto the default NDJSON headers. */
  headers?: HeadersInit;
}

/**
 * Encode one value as an NDJSON line — `JSON.stringify(value)` + `\n`,
 * UTF-8 bytes. Exported for routes that want to drive their own stream.
 */
export function encodeNdjsonLine(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value) + "\n");
}

/**
 * Build a streaming NDJSON `Response`. The stream is driven by `pages`, an
 * async iterable; the caller controls pagination by deciding what each page
 * contains and when the iterable ends.
 */
export function ndjsonResponse<T>(init: NdjsonResponseInit<T>): Response {
  const { pages, manifest, serialize, headers } = init;
  const project = serialize ?? ((row: T) => row);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (manifest) {
          controller.enqueue(encodeNdjsonLine(manifest));
        }
        for await (const page of pages) {
          if (page.length === 0) continue;
          // Concatenate the page into one chunk so chunked-transfer sees a
          // single network frame per page; this keeps overhead per page low.
          const lines = page.map(project).map((v) => JSON.stringify(v));
          controller.enqueue(encoder.encode(lines.join("\n") + "\n"));
        }
        controller.close();
      } catch (err) {
        // Emit a trailing error line so consumers can detect early termination.
        // The stream itself terminates normally — `controller.error()` would
        // give some clients an opaque TypeError instead.
        const message = err instanceof Error ? err.message : String(err);
        try {
          controller.enqueue(encodeNdjsonLine({ error: message }));
        } catch {
          /* controller already closed */
        }
        controller.close();
      }
    },
  });

  const baseHeaders: HeadersInit = {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    // No Content-Length — chunked transfer encoding is implicit when the
    // response body is a stream.
  };

  return new Response(stream, {
    status: 200,
    headers: { ...baseHeaders, ...headers },
  });
}
