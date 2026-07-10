---
sidebar_position: 10
title: SSE Notifications and Live Updates
---

# SSE Notifications and Live Updates

TestPlanIt uses [Server-Sent Events (SSE)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) with [Valkey](https://valkey.io/) (or Redis) pub/sub fan-out to push updates to clients in near-real time. Several long-lived streams share this transport:

- **`/api/notifications/stream`** — powers the in-app notification bell. One connection per signed-in user.
- **`/api/issues/stream?projectId=<id>`** — powers live issue updates driven by inbound webhooks. One connection per project per browser, regardless of how many components on the page are watching that project.
- **`/api/milestones/{milestoneId}/stream`** — powers live updates on a single milestone's detail page. One connection per milestone per browser.
- **`/api/projects/{projectId}/milestones/stream`** — powers live updates for every milestone in a project at once. One connection per project per browser; list pages hold a single connection covering every milestone card rather than one per card.

All streams have the same ingress/proxy requirements (no buffering, long idle timeouts) and the same observability surface; the differences are limited to the connection caps each route applies. This page documents how the transport works, the ingress/proxy configuration required to make long-lived streams reliable behind a load balancer, and the tuning knobs available to operators.

## What it is and how it works

Before this transport existed, the bell polled `useFindManyNotification` every 5–30 seconds per session. That worked but does not scale — every active browser tab generates 2–12 unnecessary requests per minute even when nothing changed.

The current architecture replaces that with:

1. **Publish.** When the notification worker (`testplanit/workers/notificationWorker.ts`) creates a `Notification` row, it publishes a small wake-up payload (`{id, event}`) to a tenant-scoped Valkey channel. Channel keys are constructed in one place — `testplanit/lib/notifications/channels.ts`:
   - User channel: `notifications:tenant:<tenantId>:user:<userId>`
   - Broadcast channel (used for `SYSTEM_ANNOUNCEMENT`): `notifications:tenant:<tenantId>:broadcast`
2. **Subscribe.** Each authenticated client opens a long-lived `EventSource` connection to `GET /api/notifications/stream` (`testplanit/app/api/notifications/stream/route.ts`). The route subscribes to both the user channel and the tenant broadcast channel for the requesting user.
3. **Refetch.** On every SSE message, the bell calls `refetch()` on its existing `useFindManyNotification` query. The wake-up payload is treated as opaque "something changed" — actual notification data is fetched through the policy-enforced ZenStack hook so multi-tenant isolation and access control are re-applied on every read.

The pub/sub layer is treated as untrusted plumbing: even if a wake-up arrives wrongly, the read path cannot leak data because `getEnhancedDb` re-applies the tenant filter and access policy. Tenant context for both publish and subscribe is resolved server-side via `getCurrentTenantId()` (`testplanit/lib/multiTenantPrisma.ts`), which reads `INSTANCE_TENANT_ID` from the environment — never from client input.

A single shared Valkey instance handles fan-out for every tenant; isolation is by channel-key prefix, not by separate Valkey deployments. The Valkey already provisioned for BullMQ is reused.

### Issue updates stream

The `/api/issues/stream` route follows the same publish/subscribe model with project-scoped channels (`issues:tenant:<tenantId>:project:<projectId>`). Inbound webhook handlers publish a small `{event, issueId, projectId}` envelope after applying the upstream change to the linked `Issue` row. Authentication and project-access enforcement happen at subscribe time — the route refuses to subscribe a user who cannot read the project, mirroring the policy gate that the notification bell relies on for tenant isolation.

In the browser, the React client uses a refcounted singleton EventSource per project: the first component that subscribes to a project opens the connection, additional subscribers share it, and the connection closes when the last subscriber unmounts. This keeps file-descriptor pressure low — a page with twenty issue badges, a list, and a detail popover for the same project still uses one EventSource. The route's per-user cap therefore bounds the number of distinct projects a user can watch concurrently from one browser, not the number of components on the page.

### Milestone streams

Milestones publish over a pair of routes rather than one:

- `/api/milestones/[milestoneId]/stream` — a per-milestone channel (`live:tenant:<tenantId>:milestone:<milestoneId>`) for the milestone detail page.
- `/api/projects/[projectId]/milestones/stream` — a per-project channel (`live:tenant:<tenantId>:project:<projectId>:milestones`) for the milestones list page and the Import from Jira picker, so a project with many milestones doesn't open one connection per card.

Every wake-up is published to both channels, so either consumer pattern stays current. Payloads are the same thin wake-up shape as the other streams — an event name plus the affected ids (`{event, milestoneId, projectId, targetId?}`), for events like `milestone.updated`, `milestone.converted`, and `milestone.membership_changed` — never the milestone data itself; clients refetch through the normal policy-enforced API on every wake-up. Both routes gate subscription on the requesting user being able to read the milestone or project (a 404, not a 403, on a failed check, so an inaccessible id isn't confirmed to exist), send the same `{event:"sync"}` checkpoint right after subscribing, and emit the same 25-second heartbeat comment as the notifications and issues streams.

In the browser, both hooks (`useMilestoneLiveStream`, `useProjectMilestoneStream`) share the same refcounted singleton-EventSource registry: every component subscribed to the same milestone or project stream reuses one connection, which closes after a short grace period once the last subscriber unmounts.

## Ingress and proxy configuration

SSE relies on the connection staying open and on byte-by-byte delivery. Most ingress controllers and load balancers buffer responses and apply short idle timeouts by default — both will break SSE. The same TestPlanIt application image runs in every environment; the differences are configuration on the ingress, not in the code.

The route already sets these response headers, which most proxies respect when they are configured to honor them:

```text
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

`X-Accel-Buffering: no` is the nginx convention for disabling response buffering on a per-response basis; many ingress controllers downstream honor it.

### nginx-ingress (Kubernetes)

Annotate the Ingress resource that fronts the TestPlanIt service:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: testplanit
  annotations:
    # Disable response buffering so SSE bytes are forwarded as soon as they arrive.
    nginx.ingress.kubernetes.io/proxy-buffering: 'off'
    # Lengthen idle timeouts so streams survive periods without messages.
    nginx.ingress.kubernetes.io/proxy-read-timeout: '3600'
    nginx.ingress.kubernetes.io/proxy-send-timeout: '3600'
```

`proxy-read-timeout` of 3600 seconds (1 hour) is well over the 25-second heartbeat that the route emits, leaving wide margin for transient network slowness.

### Traefik

Traefik does not buffer streamed responses by default, but its idle timeouts may need to be raised. Set `respondingTimeouts` on the entryPoint. Example (Traefik v2 / v3 static config):

```yaml
entryPoints:
  websecure:
    address: ':443'
    transport:
      respondingTimeouts:
        readTimeout: '1h'
        writeTimeout: '1h'
        idleTimeout: '1h'
```

No additional middleware is required for the route specifically — the application's own `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` headers are sufficient.

### AWS Load Balancer Controller (ALB)

For an Application Load Balancer in front of TestPlanIt:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: testplanit
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/load-balancer-attributes: idle_timeout.timeout_seconds=3600
```

The `idle_timeout.timeout_seconds=3600` attribute raises the ALB's connection idle timeout to one hour. The 25-second heartbeat on the route ensures the connection has bytes flowing well within that window.

HTTP/2 is enabled by default on ALB v2; no extra configuration needed. SSE multiplexes per-stream over HTTP/2, which keeps file-descriptor pressure low for clients with many tabs.

### Plain nginx (non-ingress)

For deployments that put TestPlanIt behind a manually configured nginx (e.g. on a single docker-compose host), add a location block for each stream. All routes need the same directives, so a regex location is the most compact way to cover them:

```nginx
location ~ ^/api/(notifications|issues)/stream|^/api/milestones/[^/]+/stream|^/api/projects/[^/]+/milestones/stream {
  proxy_pass http://testplanit_upstream;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_buffering off;
  proxy_cache off;
  proxy_read_timeout 3600s;
  proxy_send_timeout 3600s;
  chunked_transfer_encoding off;
}
```

## Tuning knobs

Each route has its own per-tenant and per-user connection caps so a misbehaving issue-stream pod cannot starve the notification bell, and vice versa.

### Notifications stream

| Variable             | Default | Purpose                                                                                                                                                                                                                                                                                            |
| -------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SSE_PER_TENANT_CAP` | `1000`  | Maximum concurrent SSE connections per tenant per pod. The Nth+1 connection receives HTTP `503 Service Unavailable` with a `Retry-After: 30` header. With N replicas, a tenant can hold up to N × cap connections cluster-wide; the per-pod cap is intentional fd-exhaustion / runaway protection. |
| `SSE_PER_USER_CAP`   | `4`     | Maximum concurrent SSE connections per user per pod. The 5th connection is accepted; the oldest connection for that user is closed (LRU). This is a fairness mechanism — it prevents a single user with many tabs from monopolizing tenant capacity.                                               |

### Issue updates stream caps

| Variable                    | Default | Purpose                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SSE_ISSUES_PER_TENANT_CAP` | `1000`  | Same semantics as `SSE_PER_TENANT_CAP`, applied to the issue-update stream.                                                                                                                                                                                                                                                                          |
| `SSE_ISSUES_PER_USER_CAP`   | `8`     | Maximum concurrent issue-update connections per user per pod. Higher than the notifications cap because the singleton EventSource manager opens one connection per project the user is watching, and a project switcher / multi-project workflow can legitimately need more open project streams than notification streams (which are user-scoped). |

All four variables are read once at module load. Restart the application pods after changing them.

### Milestone stream caps

The milestone routes don't implement their own per-tenant or per-user connection caps — there is no `SSE_MILESTONES_*` equivalent to the variables above. They share the same Valkey connection, the same subscribe-time access gate, and the same fail-closed `503`/`Retry-After: 30` response when Valkey isn't reachable, but connection volume for these two routes is bounded only by the browser-side refcounted singleton (one connection per milestone or per project, however many components subscribe) rather than a server-side cap.

## Observability

The route emits a structured stdout log line every 30 seconds for every tenant with at least one active connection:

```json
{"metric":"sse.connections.active","tenantId":"<tenantId>","count":<n>,"podId":"<hostname>","ts":"<iso>"}
```

Operators ingest this through whatever log pipeline already collects application stdout (Loki, Datadog, CloudWatch, etc.). No new HTTP endpoint, no new dependency, no new credentials to provision. A future cross-cutting Observability milestone may migrate this to a Prometheus gauge — until then the structured stdout line is the canonical metric.

The route also logs (at `console.warn`) when:

- Subscribe to Valkey fails for a connection (`[sse/notifications] subscribe failed`).
- The notification worker's best-effort SSE publish fails (`[notificationWorker] SSE publish failed`).

Both are non-fatal: SSE is a wake-up signal, the `Notification` row is the source of truth, and clients self-heal on reconnect via the route's `{event:"sync"}` first byte.

## Graceful shutdown

The route registers a `SIGTERM` handler that, on signal, writes `event: shutdown\ndata: {}\n\n` to every active stream, unsubscribes each subscriber, and closes the underlying Valkey clients. EventSource's built-in auto-reconnect on the client kicks in — combined with the route's sync-on-connect, users are reconnected and resynced on a different pod within seconds. Set `terminationGracePeriodSeconds` on the pod to at least 30 seconds (60 seconds is a safer margin) to give the handler room to drain.

## Future helm chart checklist

The TestPlanIt helm chart is planned for a future milestone. The same TestPlanIt application image runs in every environment — the only environment-specific knobs are ingress annotations and the two tuning env vars. When the chart is built, the following values must be exposed for SSE to work portably:

- `sse.perTenantCap` → `SSE_PER_TENANT_CAP` env var
- `sse.perUserCap` → `SSE_PER_USER_CAP` env var
- Ingress annotations block that defaults to the nginx-ingress / Traefik / ALB examples above
- `terminationGracePeriodSeconds` ≥ 30 on the application Deployment (60 recommended)

## Reference files

- Route: `testplanit/app/api/notifications/stream/route.ts`
- Channel helpers: `testplanit/lib/notifications/channels.ts`
- Publisher: `testplanit/workers/notificationWorker.ts` (after `prisma.notification.create`)
- Valkey wiring: `testplanit/lib/valkey.ts` (default singleton + `createSubscriberClient` factory)
- Bell client: `testplanit/components/NotificationBell.tsx` (EventSource useEffect)
- Milestone per-milestone route: `testplanit/app/api/milestones/[milestoneId]/stream/route.ts`
- Milestone per-project route: `testplanit/app/api/projects/[projectId]/milestones/stream/route.ts`
- Milestone channel helpers: `testplanit/lib/live/channels.ts` (`milestoneChannel`, `milestoneProjectChannel`)
- Milestone publisher: `testplanit/lib/live/publish.ts` (`publishMilestoneWakeUp`)
- Milestone client hooks: `testplanit/hooks/useMilestoneLiveStream.ts` (`useMilestoneLiveStream`, `useProjectMilestoneStream`, refcounted singleton EventSource registry)
