# TestPlanIt Helm chart

Single-tenant, self-hosted deployment of [TestPlanIt](https://testplanit.com) on
Kubernetes (EKS, GKE, AKS, k3s, …).

The chart deploys:

- the **web application** (Next.js server),
- the **background workers** (BullMQ processors + scheduler),
- a one-shot **migrate/seed job** (schema, audit triggers, PostgreSQL extensions,
  initial admin),

and — optionally, enabled by default — bundled **PostgreSQL**, **Valkey**,
**Elasticsearch**, and **MinIO** so `helm install` yields a working instance out
of the box. Each bundled datastore can be turned off and swapped for a managed
service (RDS / ElastiCache / OpenSearch / S3).

> This chart is **single-tenant**: one organization, one instance. It is not a
> multi-tenant / SaaS deployment.

## Prerequisites

- Kubernetes ≥ 1.25 and Helm ≥ 3.8
- An ingress controller (the default annotations target
  [ingress-nginx](https://kubernetes.github.io/ingress-nginx/)) **or** set
  `ingress.enabled=false` and expose the Service yourself
- A `StorageClass` for the bundled datastores (or use managed services)

## Images

The chart defaults to the **official public images**, which are domain-agnostic
and multi-arch (`linux/amd64` + `linux/arm64`), so they run unmodified on
standard x86 EKS/GKE/AKS nodes and on arm64 / Graviton — no build required:

```text
ghcr.io/testplanit/testplanit-selfhost:latest           # server
ghcr.io/testplanit/testplanit-selfhost:latest-workers   # workers
```

Pin `image.tag` to a released version for reproducible deploys instead of the
moving `latest`.

<details>
<summary>Build & push your own instead (optional)</summary>

```bash
git clone https://github.com/testplanit/testplanit.git
cd testplanit/testplanit
docker buildx bake -f docker-bake.hcl --push selfhost \
  --set "*.args.VERSION=1.0.0" \
  --set "production-selfhost.tags=<registry>/testplanit:1.0.0" \
  --set "workers-selfhost.tags=<registry>/testplanit:1.0.0-workers"
```

Then set `image.repository`/`image.tag`. The `selfhost` targets build with
`SELF_HOSTED=true` (domain-agnostic) and multi-arch. For a private registry, set
`image.pullSecrets`.
</details>

## Install

Minimum values:

```yaml
# my-values.yaml
appUrl: https://testplanit.example.com

ingress:
  host: testplanit.example.com
  tls:
    enabled: true
    secretName: testplanit-tls           # cert for the host above

secrets:
  adminPassword: "change-me"              # initial admin login
  # encryptionKey: "<64-hex>"             # recommended: set & back up (see below)

# image:                                  # optional — defaults to the public image
#   tag: "1.0.0"                          # pin instead of latest
```

```bash
helm install testplanit ./helm/testplanit \
  --namespace testplanit --create-namespace \
  -f my-values.yaml
```

Sign in as `admin@example.com` (configurable via `config.admin.email`) with the
password from `secrets.adminPassword`.

## 3. Production: use managed datastores

Disable the bundled datastores and point at managed services:

```yaml
postgresql:
  enabled: false
  external:
    url: "postgresql://user:pass@my-rds.rds.amazonaws.com:5432/testplanit?schema=public"
    # If a transaction-mode pooler (RDS Proxy / pgbouncer) fronts the URL above,
    # add ?pgbouncer=true to it and set a direct (non-pooled) URL for schema sync:
    directUrl: "postgresql://user:pass@my-rds.rds.amazonaws.com:5432/testplanit?schema=public"

redis:
  enabled: false
  external:
    url: "valkey://my-elasticache.cache.amazonaws.com:6379"

elasticsearch:
  enabled: false
  external:
    node: "https://my-opensearch.es.amazonaws.com:9200"   # "" disables search

objectStorage:
  minio:
    enabled: false
  external:
    region: us-east-1
    bucket: my-testplanit-bucket
    # Omit both keys to use pod IAM (IRSA): set the role ARN on
    # serviceAccount.annotations instead.
    accessKeyId: "..."
    secretAccessKey: "..."
```

## The ENCRYPTION_KEY

`ENCRYPTION_KEY` encrypts integration credentials and API tokens at rest. If not
provided, the chart generates one on first install and **preserves it across
`helm upgrade`** (via a `lookup` of the existing Secret). It must never change —
if it is lost, encrypted data becomes unreadable. For anything beyond a scratch
install, set it explicitly (`secrets.encryptionKey`, a 64-char hex string) or
supply it through `secrets.existingSecret`, and back it up.

Generate one with:

```bash
openssl rand -hex 32
```

## Secrets management (Vault / External Secrets / SOPS)

Set `secrets.existingSecret` to the name of a Secret you manage. The chart then
creates no Secret of its own and reads every secret env var from yours. It must
contain: `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `DATABASE_URL`, `VALKEY_URL`,
`ADMIN_PASSWORD`, and (when the matching bundled datastore is enabled)
`POSTGRES_PASSWORD`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`; plus, as needed,
`DIRECT_DATABASE_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`EMAIL_SERVER_PASSWORD`.

## How it fits together

- **migrate job** — a `post-install,post-upgrade` Helm hook that runs
  `zenstack migrate deploy` → audit triggers → PostgreSQL extensions → seed. It
  is the single authoritative schema owner; app and worker pods wait for the
  schema (via an init container) before starting and do **not** migrate on boot.
- **server** — runs `node server.js`; readiness is `/api/health`, liveness is a
  TCP check, with a 15s pre-stop drain for zero-downtime rollouts behind
  ingress-nginx.
- **workers** — a single replica (it also registers the scheduled jobs, so
  running more than one would double-register cron work).

## Values

See [`values.yaml`](./values.yaml) for the full, commented list. The most
commonly changed keys:

| Key | Description |
|-----|-------------|
| `image.repository`, `image.tag` | Your server image (required). Workers default to `<tag>-workers`. |
| `image.pullSecrets` | Pull secrets for a private registry / ECR. |
| `appUrl` | Public HTTPS URL (sets `NEXTAUTH_URL`). Required. |
| `ingress.host`, `ingress.tls.*` | Hostname and TLS for the Ingress. |
| `server.replicaCount`, `server.resources` | Web tier scale/size. |
| `workers.resources` | Worker tier size (keep `replicaCount` at 1). |
| `config.auth.*` | Signup / password / magic-link / email-verification toggles. |
| `config.email.*`, `secrets.emailPassword` | Outbound SMTP. |
| `config.extraEnv`, `secrets.extraEnv`, `server.extraEnv`, `workers.extraEnv` | Escape hatches for any other env (OAuth clients, tuning knobs, read replicas, …). |
| `postgresql.*`, `redis.*`, `elasticsearch.*`, `objectStorage.*` | Bundle or point at managed services. |
| `serviceAccount.annotations` | e.g. an IRSA role ARN for S3 without static keys. |
