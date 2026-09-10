---
sidebar_label: 'Generic webhook'
title: 'Automated Execution with a generic webhook'
description: Connect any CI system or custom runner — Buildkite, CircleCI, Azure Pipelines, a home-grown service — to TestPlanIt's automated execution through a signed webhook
---

# Generic webhook setup

A **generic webhook** target makes TestPlanIt POST a signed JSON request to a URL you configure whenever a run is executed. Anything that can receive an HTTP request and start a job works: Buildkite, CircleCI, Azure Pipelines, Argo, a small relay service in front of your CI, or Jenkins ([its own guide](jenkins.md)).

Because TestPlanIt cannot ask a generic receiver how the job is doing, the job reports its own outcome with `testplanit run finish`.

## The request

```http
POST https://ci.example.com/hooks/testplanit
Content-Type: application/json
X-TestPlanIt-Event: test_run.execute
X-TestPlanIt-Signature: t=1757498400,v1=5f1c…e2a9
User-Agent: TestPlanIt-Execution/1.0
```

```json
{
  "event": "test_run.execute",
  "executionId": 17,
  "runId": 42,
  "projectId": 9,
  "ref": "main",
  "planUrl": "https://testplanit.example.com/api/test-runs/42/automation-plan?executionId=17",
  "appUrl": "https://testplanit.example.com",
  "inputs": { "TESTPLANIT_RUN_ID": "42", "TESTPLANIT_EXECUTION_ID": "17", "ENV": "staging" },
  "requestedAt": "2026-09-10T10:00:00.000Z"
}
```

- `ref` is the branch or ref chosen for this execution, or `null` for the target's default.
- `inputs` holds the reserved `TESTPLANIT_*` values and every static variable configured on the target, all as strings.
- The request follows no redirects and waits at most 10 seconds for a response.

## The response

- Any **2xx** status means the dispatch was accepted; the execution becomes *Dispatched*.
- **401** or **403** are reported as an authentication problem; any other non-2xx as a provider error. Both show as *Could not start* on the run page with the status code.
- An optional JSON body lets the run page link to the job:

  ```json
  { "externalRunId": "build-5123", "externalUrl": "https://ci.example.com/builds/5123" }
  ```

  A response from Jenkins' Generic Webhook Trigger plugin is recognised and linked to the job page automatically.

## Verifying the signature

The `X-TestPlanIt-Signature` header is `t=<unix seconds>,v1=<hex>`, where `v1` is HMAC-SHA256 over the string `<t>.<raw body>` using the target's signing secret. The secret is generated when the target is saved and shown once; **Generate a new signing secret** on the target replaces it immediately, so update the receiver at the same time. Verify before acting on the request, and reject timestamps older than a few minutes to blunt replays. The examples below accept any `v1` value in the header, which also covers a future header with more than one.

Node.js:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyTestPlanIt(rawBody, header, secret, maxAgeSeconds = 300) {
  const parts = Object.fromEntries(
    header.split(",").map((kv) => kv.split("=")).map(([k, v]) => [k, v])
  );
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > maxAgeSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const given = header
    .split(",")
    .filter((kv) => kv.startsWith("v1="))
    .map((kv) => kv.slice(3));
  return given.some(
    (sig) => sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  );
}
```

Python:

```python
import hmac, hashlib, time

def verify_testplanit(raw_body: bytes, header: str, secret: str, max_age=300) -> bool:
    parts = header.split(",")
    t = int(next(p[2:] for p in parts if p.startswith("t=")))
    if abs(time.time() - t) > max_age:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(p[3:], expected) for p in parts if p.startswith("v1="))
```

Compute the HMAC over the **raw** request body, byte for byte, not over a re-serialised JSON object.

## What the receiver must do

1. Verify the signature and respond **2xx** quickly. Start the job asynchronously if starting it takes long; TestPlanIt gives up on the request after 10 seconds.
2. Pass `runId`, `executionId`, `projectId`, `appUrl` and `planUrl` into the job's environment as `TESTPLANIT_RUN_ID`, `TESTPLANIT_EXECUTION_ID`, `TESTPLANIT_PROJECT_ID`, `TESTPLANIT_URL` and `TESTPLANIT_PLAN_URL`, together with the job's own TestPlanIt API token as `TESTPLANIT_TOKEN` (CLI) and `TESTPLANIT_API_TOKEN` (reporters).
3. In the job, read the plan, run the planned tests and report results; see [Reporting results back](reporting-results.md).
4. End the job with `testplanit run finish --conclusion success|failure|cancelled`. Without it the execution shows *Running* once results arrive and waits for the target's timeout.

A minimal relay for Buildkite, for example, verifies the signature and calls Buildkite's *create build* API with the fields above as build environment variables; a CircleCI relay calls the *trigger pipeline* API with them as pipeline parameters. Azure Pipelines can be reached the same way through *runs*, with the fields as template parameters or variables.

## Adding the target

1. Open the project's **Settings → Automated Execution** and click **Add target**.
2. Choose **Generic webhook**, enter the **Webhook URL** (`https://` recommended), and optionally **Variables**, static values sent under `inputs` with every dispatch.
3. Save and **copy the signing secret** from the dialog; it is shown once. Store it in the receiver's secret store.
4. Click **Verify**. For a generic target it validates the URL and reminds you that only a real dispatch proves the receiver works. The **Payload** preview on the target shows exactly what will be sent.

## Private addresses

TestPlanIt refuses to send a dispatch to a private or internal address (RFC 1918 ranges, loopback, link-local, `.local` names) unless the operator lists the host in the `ALLOWED_PRIVATE_HOSTS` environment variable on the TestPlanIt server, as a comma-separated list of host names or addresses:

```
ALLOWED_PRIVATE_HOSTS=jenkins.internal,10.0.4.12
```

Restart the app and the workers after changing it. A blocked dispatch shows *Could not start* with a message naming the host.
