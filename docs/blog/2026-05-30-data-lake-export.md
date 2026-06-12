---
slug: data-lake-export
title: 'Stream test data straight into your data lake'
description: "TestPlanIt's new NDJSON bulk-export endpoints turn test execution into a first-class analytics source for Snowflake, BigQuery, Databricks, and any pipeline that speaks chunked JSON."
authors: [testplanit]
tags: [api, data-lake, analytics, integration]
---

If your data team treats test execution like any other event stream — coverage trends in Snowflake, defect heatmaps in BigQuery, regression dashboards in Databricks — you've probably written a custom ETL job to scrape pages of paginated JSON out of your test management tool.

We just made that job a one-liner.

<!-- truncate -->

## Three new endpoints, one wire format

TestPlanIt now ships three GET endpoints designed for analytics ingestion:

- `/api/export/test-run-results` — the execution **fact table** (one row per recorded result)
- `/api/export/repository-cases` — the test-case **dimension table**
- `/api/export/audit-log` — the **compliance feed** (one row per audited mutation)

Each one streams **NDJSON** (newline-delimited JSON) over HTTP chunked transfer encoding. That's the wire format Spark, Snowflake `COPY INTO`, BigQuery `bq load`, Databricks Auto Loader, Airbyte, Fivetran, Logstash, and Vector all natively understand. No client library, no intermediate parsing, no need to materialize the whole response — your pipeline consumes one record at a time, all the way through.

## What it looks like

Pull every result executed since the last sync:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://testplanit.example.com/api/export/test-run-results?since=2026-05-01T00:00:00Z&pageSize=1000"
```

The response opens with a manifest line, streams rows, and closes with an end-trailer:

```ndjson
{"type":"manifest","schemaVersion":1,"resource":"test-run-results","exportedAt":"...","since":"2026-05-01T00:00:00.000Z","pageSize":1000,"projectId":null}
{"id":12345,"testRunId":42,"testCaseId":200,"statusName":"Passed","isPass":true,"executedAt":"2026-05-30T10:00:00.000Z",...}
{"id":12346,"testRunId":42,"testCaseId":201,"statusName":"Failed","isPass":false,"executedAt":"2026-05-30T10:00:01.000Z",...}
...
{"type":"end","count":1000,"cursor":"eyJrIjoi..."}
```

The trailer carries a base64url cursor. Hit the same endpoint with `?cursor=<value>` to get the next page. The cursor is `null` when you've exhausted the dataset — that's the signal to stop.

## Stable forward iteration

The cursor encodes the `(executedAt, id)` tuple of the last row. The next page's WHERE clause is **strict-forward** with a tiebreaker:

```sql
WHERE (executedAt > c.executedAt)
   OR (executedAt = c.executedAt AND id > c.id)
```

That's a deliberate choice. Naïve `WHERE executedAt > c.executedAt` skips rows with identical timestamps; `WHERE executedAt >= c.executedAt` duplicates the boundary row. The composite tuple is the only way to walk the table without either. Combined with the indexed sort key, page fetches stay fast at millions of rows.

## Real-time too: the webhook event catalog

For workloads that need push, not pull, TestPlanIt's outbound webhooks fire on every meaningful state change. We now also publish the **catalog** of triggers — `case.created`, `test_run.completed`, `iteration.result.recorded`, `issue.updated`, the whole list — at `/api/webhooks/events`:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://testplanit.example.com/api/webhooks/events?category=test-run"
```

Drive your downstream subscription config from this catalog. No more reading source to figure out what events exist.

## The architecture pick

We deliberately stopped short of shipping a native Kafka/Kinesis/Pub-Sub producer. The reason: **almost everyone already has a webhook → event-bus bridge** they trust — Kafka Connect REST source, AWS API Gateway → Kinesis Firehose, Google Pub/Sub HTTP push, even a 20-line Vector pipeline. Adding three SDK adapters to TestPlanIt would mean three runbooks, three sets of CVEs, three "why isn't it delivering" failure modes — for ergonomics most of our customers don't need.

What customers DO need is the **format** their data lake speaks and the **schema** of every event. That's what these endpoints give you.

## Try it

The endpoints ship in the next release. To preview today, pull `main` and follow the [Data Lake Export](/docs/data-lake-export) docs page for end-to-end recipes — curl, Python, Spark, Snowflake `COPY INTO`, and Databricks Auto Loader are all covered.

Feedback or a request for a built-in Kafka adapter? We're listening — open a discussion on [GitHub](https://github.com/TestPlanIt/testplanit/discussions) and tell us what you'd want.
