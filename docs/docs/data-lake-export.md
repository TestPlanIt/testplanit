---
sidebar_position: 16
title: Data Lake Export
---

# Data Lake Export

TestPlanIt ships **streaming NDJSON bulk-export endpoints** for moving test data — execution results, test cases, and the audit log — into Snowflake, BigQuery, Databricks, ClickHouse, or any other analytics platform that consumes NDJSON. Paired with a published **webhook event catalog**, the same data is available as both incremental pull (cursor-paged batch) and real-time push (signed outbound webhooks) so you can mix and match: bulk-load history, then trail with webhooks.

Skim:

- Three GET endpoints under `/api/export/` return **NDJSON over chunked transfer encoding**
- Each response is one cursor-paged window with a manifest line first and an end-trailer last
- Pagination is **stable forward iteration** — repeated runs with the same `since` always see new rows, never duplicates, never skipped rows
- A fourth endpoint, `/api/webhooks/events`, publishes the **catalog of trigger names** TestPlanIt fires on, with payload schemas

## Why NDJSON

NDJSON (newline-delimited JSON) is the de-facto wire format for data-lake ingestion. Each line is a complete JSON record; consumers parse line-by-line without materializing the whole response in memory. Spark, Snowflake `COPY INTO`, BigQuery `bq load`, Databricks Auto Loader, and most generic ETL tools (Airbyte, Fivetran, Logstash, Vector) all read it natively.

Combined with HTTP chunked transfer encoding, this means:

- The **server** never buffers more than one page in memory, regardless of total export size
- The **consumer** sees the first row within a few hundred milliseconds and can start materializing rows while the database is still scanning
- A **failed mid-stream** export is obvious: the response ends with an `{"error":"..."}` line instead of an end-trailer

## Endpoints

All three endpoints share the same authentication, query parameters, and response envelope. They differ only in what rows they emit.

### `GET /api/export/test-run-results`

The **fact table** — one row per recorded result, sorted ascending by `executedAt`. This is the high-volume feed: most data-lake pipelines start here.

Each row carries:

```json
{
  "id": 12345,
  "testRunId": 42,
  "testRunCaseId": 7891,
  "testCaseId": 200,
  "projectId": 1,
  "statusId": 5,
  "statusName": "Passed",
  "isPass": true,
  "isFail": false,
  "executedAt": "2026-05-30T10:00:00.000Z",
  "executedById": "cltg18noo0001i7lh4ia312j5",
  "elapsedMs": 250,
  "attempt": 1,
  "iterationId": null,
  "editedAt": null,
  "editedById": null
}
```

### `GET /api/export/repository-cases`

The **dimension table** — one row per test case, sorted ascending by `createdAt`. Pull this on a longer cadence (nightly, weekly) to rebuild the case lookup table that denormalizes execution facts.

`since` filters by case **creation** time. Cases are versioned (every edit creates a `RepositoryCaseVersions` row) so the natural cadence for catching edits is either:

- **Full refresh** — omit `since`, walk all pages; cheap because cases are typically O(thousands), not O(millions)
- **Trail via webhooks** — subscribe to `case.updated` and apply diffs to your existing rows

Each row carries:

```json
{
  "id": 200,
  "projectId": 1,
  "folderId": 50,
  "templateId": 3,
  "stateId": 1,
  "name": "Login with invalid password",
  "className": null,
  "source": "MANUAL",
  "automated": false,
  "hasParameters": false,
  "isArchived": false,
  "estimate": 300,
  "forecastManual": 280,
  "forecastAutomated": null,
  "currentVersion": 4,
  "createdAt": "2026-03-15T09:27:00.000Z",
  "creatorId": "cltg18noo0001i7lh4ia312j5"
}
```

`currentVersion` increments on every edit. Track it between runs to detect updated cases without parsing the version history.

### `GET /api/export/audit-log`

The **compliance feed** — one row per audited mutation, sorted ascending by `timestamp`. Required for SOX/internal-audit pipelines. **Admin-only** for cross-project; non-admin tokens must supply a `projectId` they have access to.

Each row carries the actor, the entity touched, the action, the before/after diff (when captured), and the metadata blob recorded at the time:

```json
{
  "id": "clxyz123abc456",
  "timestamp": "2026-05-30T10:00:00.000Z",
  "action": "UPDATE",
  "entityType": "TestRunResults",
  "entityId": "42",
  "entityName": "Smoke test - login",
  "userId": "cltg18noo0001i7lh4ia312j5",
  "userEmail": "user@example.com",
  "userName": "User One",
  "projectId": 1,
  "changes": { "statusId": { "old": 3, "new": 5 } },
  "metadata": { "ip": "10.0.0.42", "ua": "Mozilla/...", "requestId": "..." }
}
```

## Query parameters

| Parameter   | Required    | Default | Description                                                                                                                                                    |
| ----------- | ----------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `since`     | no          | none    | ISO-8601 timestamp. Only rows with the relevant sort column ≥ `since` are emitted. `executedAt` for results, `createdAt` for cases, `timestamp` for audit log. |
| `cursor`    | no          | none    | Opaque base64url continuation token from the previous response's end-trailer. Encodes the (sort-key, id) tuple of the last row in the previous page.           |
| `pageSize`  | no          | 1000    | 1..5000. Values outside the range are silently clamped.                                                                                                        |
| `projectId` | conditional | none    | Optional for ADMIN tokens, **required** for non-admin tokens. Non-admin tokens must have access to the project they request.                                   |

## Response envelope

Every response is NDJSON: a sequence of JSON objects separated by `\n`. The shape:

```
{"type":"manifest", ...}                ← first line: per-page metadata
{"id": ..., ...}                        ← row 1
{"id": ..., ...}                        ← row 2
...
{"type":"end","count":N,"cursor":"..."} ← last line: row count + next cursor
```

**Manifest:**

```json
{
  "type": "manifest",
  "schemaVersion": 1,
  "resource": "test-run-results",
  "exportedAt": "2026-05-30T10:00:00.000Z",
  "since": "2026-05-01T00:00:00.000Z",
  "pageSize": 1000,
  "projectId": null
}
```

**End trailer:**

```json
{ "type": "end", "count": 1000, "cursor": "eyJrIjoi..." }
```

The trailer's `cursor` is `null` iff the page returned fewer rows than `pageSize` — that's the signal to stop. Otherwise, fire the next request with `?cursor=<value>`.

**Errors mid-stream:** if the database connection drops while emitting rows, the response appends a final `{"error":"..."}` line in place of the end-trailer. Consumers should treat any response that does NOT end with `{"type":"end",...}` as incomplete and retry with the same parameters.

## Authentication

Pass an API token as `Authorization: Bearer <token>`, or include a session cookie (browser-driven). API tokens are the recommended path for ETL pipelines — they're per-user, revocable, and persist across sessions. See [API Tokens](./api-tokens.md) for token issuance.

## Authorization

- **ADMIN tokens**: read across every project. Pass `projectId` to narrow to one.
- **Non-admin tokens**: must pass `projectId`. The request returns `403` if the user has no access to that project. There is no aggregate "all my projects" mode for non-admins; consumers loop over project IDs explicitly.

## Consumer recipes

### Bash + curl + jq (smoke test)

```bash
TOKEN="tpi_..."
BASE="https://your-instance.example.com/api"

# First page
curl -s -H "Authorization: Bearer $TOKEN" \
  "$BASE/export/test-run-results?since=2026-05-01T00:00:00Z&pageSize=100" \
  > page-1.ndjson

# Extract the cursor from the trailer
NEXT=$(tail -n1 page-1.ndjson | jq -r '.cursor // empty')
echo "Next cursor: $NEXT"
```

### Python (loop to exhaustion)

```python
import json, requests

TOKEN = "tpi_..."
BASE = "https://your-instance.example.com/api"
session = requests.Session()
session.headers["Authorization"] = f"Bearer {TOKEN}"

cursor = None
since = "2026-05-01T00:00:00Z"
all_rows = []

while True:
    params = {"since": since, "pageSize": 1000}
    if cursor:
        params["cursor"] = cursor
    resp = session.get(f"{BASE}/export/test-run-results", params=params, stream=True)
    resp.raise_for_status()
    trailer = None
    for line in resp.iter_lines():
        if not line:
            continue
        row = json.loads(line)
        if row.get("type") == "manifest":
            continue
        if row.get("type") == "end":
            trailer = row
            continue
        if row.get("error"):
            raise RuntimeError(f"export failed: {row['error']}")
        all_rows.append(row)
    if not trailer or not trailer.get("cursor"):
        break
    cursor = trailer["cursor"]

print(f"exported {len(all_rows)} results")
```

### Spark / Databricks

```python
# Single-node ingestion; for production use a Bronze/Silver pattern.
df = (
  spark.read
    .option("multiline", "false")
    .json(f"https://your-instance.example.com/api/export/test-run-results?since={since_iso}",
          # use a custom HTTP DataSource or wget into DBFS first; Spark .json() doesn't pass Authorization headers natively
          )
)
df.write.mode("append").saveAsTable("bronze.testplanit_results")
```

In production, prefer pulling into DBFS / S3 / GCS via a scheduled job, then `COPY INTO` from the lake into your warehouse.

### Snowflake (`COPY INTO` from external stage)

```sql
COPY INTO bronze.testplanit_results
FROM @testplanit_export/test-run-results/
FILE_FORMAT = (TYPE = JSON, STRIP_OUTER_ARRAY = FALSE)
ON_ERROR = 'CONTINUE';
```

Run a small bridge script (Python, Airflow, anything) to fetch the NDJSON from `/api/export/test-run-results`, drop it into your S3/GCS external stage, then trigger the `COPY INTO`.

## Webhook event catalog

For real-time pushes (rather than polling), TestPlanIt fires signed outbound webhooks on internal triggers. The full list of trigger names is published at `GET /api/webhooks/events`. Optional `?category=` filter restricts to one of: `test-case`, `test-run`, `iteration`, `session`, `issue`, `review`, `system`.

Each catalog entry carries:

```json
{
  "name": "test_run.completed",
  "category": "test-run",
  "description": "A test run was marked complete (state moved into a terminal state).",
  "payloadKeys": ["id", "projectId", "completedAt", "summary"]
}
```

Use the catalog to drive subscription configuration in your data platform without reading TestPlanIt source. The endpoint is read-only; webhook subscription CRUD lives at `/api/webhooks/configs` (covered in [Webhooks](./user-guide/webhooks.md)).

## Operational notes

- **Performance**: the export endpoints read from the same database as the application but the queries are bounded (`take: pageSize`) and use indexed sort keys, so they don't tank OLTP. Run them off-peak if your instance is volume-sensitive.
- **Backpressure**: NDJSON streams as fast as the consumer reads. If you suspect overload, lower `pageSize` and the database scan window per request shrinks accordingly.
- **Soft-deletes**: all three endpoints filter `isDeleted = false`. Soft-deleted rows do not appear in the export; consumers see deletes via `*.deleted` webhook events instead.
- **Time zone**: every timestamp in the response is UTC, ISO-8601, with millisecond precision. `since` accepts any timezone-qualified ISO-8601 and is normalized to UTC server-side.
