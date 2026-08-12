---
title: Kubernetes (Helm)
sidebar_position: 6
---

# Deploying TestPlanIt on Kubernetes with Helm

This guide deploys a **single-tenant, self-hosted** TestPlanIt instance to a
Kubernetes cluster (Amazon EKS, GKE, AKS, or k3s) using the official Helm chart.
It is the recommended path for organizations that already run their internal
tools on Kubernetes.

The chart lives in the repository at [`testplanit/helm/testplanit`](https://github.com/testplanit/testplanit/tree/main/testplanit/helm/testplanit).

## What gets deployed

- **Web application** — the Next.js server (the UI and API).
- **Background workers** — BullMQ job processors plus the scheduler.
- **Migrate/seed job** — a Helm hook that applies migrations, audit triggers, and
  PostgreSQL extensions, then seeds the initial admin. It is the single
  authoritative schema owner; the app and worker pods wait for it and never
  migrate on boot.
- **Bundled datastores (optional, on by default)** — PostgreSQL, Valkey,
  Elasticsearch, and MinIO, so a first install works out of the box. Each can be
  turned off and pointed at a managed service (Amazon RDS / ElastiCache /
  OpenSearch / S3).

## Prerequisites

- Kubernetes ≥ 1.25 and Helm ≥ 3.8
- `kubectl` and `helm` configured against your cluster
- An ingress controller — the default annotations target
  [ingress-nginx](https://kubernetes.github.io/ingress-nginx/); or set
  `ingress.enabled=false` and expose the Service yourself
- A default `StorageClass` (for the bundled datastores) — or use managed services

## Images

The chart uses the **official public images** by default — no build step. They
are domain-agnostic and multi-arch (`linux/amd64` + `linux/arm64`), so they run
unmodified on standard x86 EKS/GKE/AKS nodegroups and on arm64 / Graviton:

```text
ghcr.io/testplanit/testplanit-selfhost:latest           # server
ghcr.io/testplanit/testplanit-selfhost:latest-workers   # workers
```

Pin `image.tag` to a released version (e.g. `1.0.0`) for reproducible deploys
rather than the moving `latest`.

<details>
<summary>Prefer to build & push your own?</summary>

```bash
git clone https://github.com/testplanit/testplanit.git
cd testplanit/testplanit
docker buildx bake -f docker-bake.hcl --push selfhost \
  --set "*.args.VERSION=1.0.0" \
  --set "production-selfhost.tags=<registry>/testplanit:1.0.0" \
  --set "workers-selfhost.tags=<registry>/testplanit:1.0.0-workers"
```

The `selfhost` targets build with `SELF_HOSTED=true` (Next image optimizer off,
so no domain is baked in) and multi-arch. Then set `image.repository` /
`image.tag`. For a private registry, set `image.pullSecrets` (on EKS with ECR,
attach an ECR pull policy to the node role or use a pull secret).
</details>

## Step 1: Minimal values

Create `my-values.yaml`:

```yaml
# Public HTTPS URL you serve TestPlanIt on. Sets NEXTAUTH_URL.
appUrl: https://testplanit.example.com

ingress:
  host: testplanit.example.com
  tls:
    enabled: true
    secretName: testplanit-tls   # a cert for the host (e.g. from cert-manager)

secrets:
  adminPassword: "change-me"      # initial admin login
  encryptionKey: ""               # STRONGLY recommended — set & back up (see below)

# image:                          # optional — defaults to the public image
#   tag: "1.0.0"                  # pin instead of latest
```

:::tip Live updates (SSE)
The notification bell and live milestone / test-run updates use long-lived SSE
streams. The chart's default ingress annotations do not disable proxy buffering, so
for these to work reliably override `ingress.annotations` — see
[SSE Notifications and Live Updates](./sse-notifications.md#helm-chart-deployment).
:::

## Step 2: Install

```bash
helm install testplanit ./testplanit/helm/testplanit \
  --namespace testplanit --create-namespace \
  -f my-values.yaml
```

Watch the rollout:

```bash
# Migrate/seed job first
kubectl -n testplanit logs -l app.kubernetes.io/component=migrate --tail=100 -f

# Then the app + workers
kubectl -n testplanit rollout status deploy/testplanit
kubectl -n testplanit get pods
```

Sign in at your `appUrl` as `admin@example.com` (change via `config.admin.email`)
with the password from `secrets.adminPassword`.

### Private registry pull secret

```bash
kubectl -n testplanit create secret docker-registry regcred \
  --docker-server=<registry> --docker-username=<user> --docker-password=<pass>
```

```yaml
image:
  pullSecrets:
    - name: regcred
```

## Step 3: Use managed datastores (production)

For anything beyond evaluation, disable the bundled datastores and point at
managed services. The bundled datastores are single-replica and intended for
quick starts and small installs.

```yaml
postgresql:
  enabled: false
  external:
    url: "postgresql://user:pass@my-rds.rds.amazonaws.com:5432/testplanit?schema=public"
    # If a transaction-mode pooler (RDS Proxy / pgbouncer) fronts the URL above,
    # append ?pgbouncer=true to it and provide a direct (non-pooled) URL that the
    # schema-sync/migrate step uses:
    directUrl: "postgresql://user:pass@my-rds.rds.amazonaws.com:5432/testplanit?schema=public"

redis:
  enabled: false
  external:
    url: "valkey://my-elasticache.cache.amazonaws.com:6379"

elasticsearch:
  enabled: false
  external:
    node: "https://my-opensearch.es.amazonaws.com:9200"   # empty string disables search

objectStorage:
  minio:
    enabled: false
  external:
    region: us-east-1
    bucket: my-testplanit-bucket
    # Omit both keys to use pod IAM (IRSA) instead of static credentials:
    accessKeyId: "..."
    secretAccessKey: "..."
```

See [External Database Deployment](./external-database-deployment.md) for the
PostgreSQL ownership/permission setup, and
[Horizontal Read Scaling](./horizontal-read-scaling.md) to add read replicas.

### S3 access without static keys (EKS / IRSA)

Attach an IAM role to the chart's ServiceAccount and leave the S3 keys empty:

```yaml
serviceAccount:
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/testplanit-s3

objectStorage:
  minio:
    enabled: false
  external:
    region: us-east-1
    bucket: my-testplanit-bucket
    accessKeyId: ""       # empty -> use the pod's IAM role
    secretAccessKey: ""
```

## The ENCRYPTION_KEY

`ENCRYPTION_KEY` encrypts integration credentials and API tokens at rest. When
you don't set it, the chart generates one on first install and **preserves it
across `helm upgrade`**. It must never change — if it is lost or rotated, all
encrypted data becomes unreadable.

For any real deployment, set it explicitly and back it up. Generate one with:

```bash
openssl rand -hex 32
```

Then set `secrets.encryptionKey` (or supply it via `secrets.existingSecret`). To
read the auto-generated value:

```bash
kubectl -n testplanit get secret testplanit-env \
  -o jsonpath='{.data.ENCRYPTION_KEY}' | base64 -d
```

## Secrets management (Vault / External Secrets / SOPS)

To manage secrets outside the chart, set `secrets.existingSecret` to the name of
a Secret you control. The chart then creates no Secret and reads every secret env
var from yours. Required keys: `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`,
`DATABASE_URL`, `VALKEY_URL`, `ADMIN_PASSWORD`; when the matching bundled
datastore is enabled, also `POSTGRES_PASSWORD`, `MINIO_ROOT_USER`,
`MINIO_ROOT_PASSWORD`; and as needed `DIRECT_DATABASE_URL`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `EMAIL_SERVER_PASSWORD`.

## Email (SMTP)

```yaml
config:
  email:
    host: smtp.example.com
    port: "587"
    user: notifications@example.com
    from: testplanit@example.com
secrets:
  emailPassword: "smtp-password"
```

## Upgrades

Build and push a new image tag, then:

```bash
helm upgrade testplanit ./testplanit/helm/testplanit \
  --namespace testplanit -f my-values.yaml \
  --set image.tag=1.1.0
```

The migrate/seed job re-runs on every upgrade (idempotent) and applies any new
migrations before the new app pods take traffic. The web tier rolls with zero
downtime (surge-up + a 15s pre-stop drain behind ingress-nginx).

## Scaling

- **Web tier** — increase `server.replicaCount` (a PodDisruptionBudget is created
  automatically at ≥ 2). Size with `server.resources`.
- **Workers** — keep `workers.replicaCount` at **1**: the workers pod also
  registers the scheduled/repeatable jobs, so multiple replicas would
  double-register cron work. Give it more headroom with `workers.resources`.

## Uninstall

```bash
helm uninstall testplanit --namespace testplanit
```

PersistentVolumeClaims from the bundled datastores are retained by default —
delete them explicitly to remove the data:

```bash
kubectl -n testplanit delete pvc -l app.kubernetes.io/instance=testplanit
```

## Troubleshooting

- **App pods stuck in `Init`** — the `wait-for-db` init container blocks until the
  database is reachable and the schema exists. Check the migrate job:
  `kubectl -n testplanit logs -l app.kubernetes.io/component=migrate`.
- **`ImagePullBackOff`** — the cluster can't pull your image. Verify the tag and
  set `image.pullSecrets` for a private registry.
- **Health** — `GET /api/health` reports per-dependency status (database is
  required; redis / elasticsearch / storage degrade gracefully):
  `kubectl -n testplanit port-forward svc/testplanit 3000:3000` then
  `curl -s localhost:3000/api/health | jq`.
- **Event-loop lag** — the same response carries an `eventLoop` object with
  `p50` / `p99` / `max` lag in milliseconds. The app serves every request from a
  single JS thread, so this is the capacity signal container CPU% cannot show —
  a rising `p99` means the thread is saturated even while CPU looks healthy. It
  is reported for monitoring only and never changes the overall `status`, so it
  will not flap your liveness probe.

For the Docker Compose deployment, see [Deployment](./deployment.md).
