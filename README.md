# TestPlanIt Monorepo

This monorepo contains the source code and related files for the TestPlanIt project.

## Screenshots

![Test Cases](testplanit/assets/test-cases.png)
![QuickScript](testplanit/assets/quickscript.png)
![Test Runs](testplanit/assets/test-runs.png)
![Sessions](testplanit/assets/sessions.png)
![Issues](testplanit/assets/issues.png)
![Reports](testplanit/assets/reports.png)

## Structure

This repository uses [pnpm workspaces](https://pnpm.io/workspaces) to manage multiple packages.

-   **`testplanit/`**: The main TestPlanIt application.
-   **`docs/`**: Documentation for the project.
-   **`forge-app/`**: TestPlanIt for Jira plugin.
-   **`cli/`**: Command-line interface tool.
-   **`packages/`**: Shared packages (API client, reporters).
-   **`pnpm-workspace.yaml`**: Defines the workspaces within the monorepo.
-   **`package.json`**: Root package configuration.

---

# Running TestPlanIt locally (Windows + Docker)

This guide gets TestPlanIt running on your own machine for testing and evaluation. It is written for
Windows with Docker Desktop; the commands are the same on macOS/Linux apart from the WSL2 section.

> [!IMPORTANT]
> **Local instances are for testing only.** Keep the app bound to `localhost` (this guide does that
> for you) and load **test data only** — no real customer or employee data. An internal security
> review of this codebase is outstanding and some findings are not yet remediated, so a local
> instance must not be exposed to the office network, port-forwarded, or tunnelled to the internet.
> Check with the security owner before deviating.

## 1. Prerequisites

| Requirement | Notes |
|---|---|
| **Docker Desktop** | With the WSL2 backend enabled (Settings -> General -> *Use the WSL 2 based engine*) |
| **Git** | To clone the repository |
| **Disk space** | ~25 GB for images and data |
| **RAM** | 16 GB recommended. See the memory step below — it is the most common cause of a failed build. |

### Give Docker enough memory (do this first)

The image build peaks around **7 GB**. WSL2 defaults to 50% of your host RAM, which on a 16 GB
machine is roughly 7.8 GB — just enough to fail with `JavaScript heap out of memory` partway through
a 20-minute build.

Check what Docker currently has:

```powershell
docker info --format "{{.MemTotal}}"
```

If that is below about 10 GB, create `C:\Users\<you>\.wslconfig`:

```ini
[wsl2]
memory=12GB
processors=8
swap=8GB
```

Then apply it. **Run this from Windows PowerShell, not from inside a WSL/Ubuntu terminal** — the
`wsl` command does not exist inside WSL:

```powershell
wsl --shutdown
```

Reopen Docker Desktop, wait for "Engine running", and confirm the new figure with `docker info`.

## 2. Clone and configure

```powershell
git clone https://github.com/codimite-operations/testplanit.git
cd testplanit\testplanit
copy .env.example .env.production
```

> The application reads **`.env.production`**. A file named `.env` is used only by Docker Compose for
> port substitution — its contents never reach the container. Getting this wrong gives you an app
> that starts and then fails on every page.

Now edit `.env.production` and set the values below. Everything else can stay as shipped.

```env
# --- Database: the bundled Postgres container ---
# 'postgres' is the container hostname; 'testplanit_prod' is the database the container creates.
DATABASE_URL="postgresql://user:password@postgres:5432/testplanit_prod?schema=public"

# --- App URL: must match what you type in the browser, or sign-in redirects fail ---
NEXTAUTH_URL="http://localhost:3000"

# --- Secrets: generate your own, per machine ---
# NOTE: .env.example ships the literal text "$(openssl rand -base64 32)". That is NOT executed.
# Run the command yourself and paste the result.
#   openssl rand -base64 32   -> NEXTAUTH_SECRET
#   openssl rand -hex 32      -> ENCRYPTION_KEY (must be exactly 64 hex characters)
NEXTAUTH_SECRET="<paste generated value>"
ENCRYPTION_KEY=<paste generated value>

# --- Search: leave empty to disable Elasticsearch and save ~3GB RAM ---
ELASTICSEARCH_NODE=

# --- File storage: route uploads through the app server ---
# Without IS_HOSTED=true, attachment uploads fail in the browser with "Failed to fetch".
AWS_ENDPOINT_URL=http://minio:9000
IS_HOSTED=true

# --- Your admin login. CHANGE THESE - the defaults are admin@example.com / admin ---
ADMIN_EMAIL=you@codimite.com
ADMIN_PASSWORD=<choose a real password>

# --- Ports: bind to localhost only (see the notice at the top) ---
# The default "3000:3000" listens on ALL network interfaces, making your instance reachable
# by anyone on the same wi-fi. The 127.0.0.1 prefix restricts it to this machine.
DOCKER_PROD_APP_PORT=127.0.0.1:3000
DOCKER_MINIO_API_PORT=127.0.0.1:9000
DOCKER_MINIO_CONSOLE_PORT=127.0.0.1:9001
DOCKER_VALKEY_PORT=127.0.0.1:6379
DOCKER_POSTGRES_PORT=127.0.0.1:5432
```

**Never commit `.env.production`** — it holds your secrets. It is already git-ignored.

## 3. Build and start

Run these from the `testplanit\testplanit` directory. The flag list is the same every time, so set it
once per terminal session:

```powershell
$C = "docker compose --env-file .env.production -f docker-compose.prod.yml --profile with-postgres --profile with-valkey --profile with-minio"
```

**Build the images.** This takes **15-30 minutes the first time** and downloads roughly 2,200
packages. It is not stuck:

```powershell
Invoke-Expression "$C build prod workers"
```

**Start the supporting services** (database, cache, file storage):

```powershell
Invoke-Expression "$C up -d postgres valkey minio minio-init"
Invoke-Expression "$C ps"
```

Wait until `postgres`, `valkey` and `minio` report `healthy`. `minio-init` will show `Exited (0)` —
that is success, not a failure; it creates the storage bucket and then stops.

**Create the database schema and seed data:**

```powershell
Invoke-Expression "$C run --rm db-init-prod"
```

Look for `DB initialized and seeded.` at the end.

**Start the application and background workers:**

```powershell
Invoke-Expression "$C up -d prod workers nginx"
Invoke-Expression "$C logs -f prod"
```

Wait for `Ready in ...`, then press `Ctrl+C` to stop tailing the logs. That does **not** stop the app.

## 4. Open it

**http://localhost:3000** — sign in with the `ADMIN_EMAIL` and `ADMIN_PASSWORD` you set.

A pre-populated **Demo Project** is created during seeding, with sample test cases, runs, sessions,
milestones and issues.

Other interfaces, if you need them:

| Service | URL | Credentials |
|---|---|---|
| MinIO console (file storage) | http://localhost:9001 | `minioadmin` / `minioadmin123` |
| PostgreSQL | `localhost:5432` | `user` / `password`, database `testplanit_prod` |

> These are the shipped development defaults and are deliberately weak. They are acceptable only
> because the ports above are bound to `localhost`. Do not reuse this configuration anywhere else.

## 5. Everyday commands

```powershell
Invoke-Expression "$C ps"                       # what is running
Invoke-Expression "$C logs -f prod"             # application logs
Invoke-Expression "$C logs -f workers"          # background job logs
Invoke-Expression "$C stop"                     # stop, keep all data
Invoke-Expression "$C up -d"                    # start again
Invoke-Expression "$C restart prod"             # restart just the app
Invoke-Expression "$C down"                     # remove containers (the data volume survives)
```

After a machine restart: open Docker Desktop, then `Invoke-Expression "$C up -d"`. **You never need
to rebuild** unless the code or dependencies change.

To wipe everything and start clean:

```powershell
Invoke-Expression "$C down"
docker volume rm testplanit-postgres-data
Remove-Item -Recurse -Force docker-data
```

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Build fails with `JavaScript heap out of memory`, or is killed | WSL2 memory limit too low | Section 1 — `.wslconfig`, then `wsl --shutdown` from **Windows** PowerShell |
| Build fails with `TypeError: fetch failed` during `pnpm install` | Slow or unstable connection; a package download timed out | Re-run the build; cached layers are reused. On a consistently slow link, build on a better connection. |
| App starts but every page errors and config looks empty | Settings are in `.env`, not `.env.production` | Compose reads `.env.production` for container variables. Rename the file. |
| `port is already allocated` | Something else uses 3000/9000/9001/5432 | `netstat -ano \| findstr :3000`, then change the matching `DOCKER_*_PORT` |
| Sign-in redirects to the wrong address, or loops | `NEXTAUTH_URL` does not match the browsed URL | Both must be exactly `http://localhost:3000` |
| Attachment upload fails with "Failed to fetch" | `IS_HOSTED` not set | Set `IS_HOSTED=true`, then `Invoke-Expression "$C up -d --force-recreate prod"` |
| App logs `getaddrinfo ENOTFOUND valkey` | Valkey is not running | `Invoke-Expression "$C up -d valkey"`, then restart `prod` |
| Workers log `Postgres is unavailable - sleeping` forever | Database not reachable under the hostname `postgres` | Expected only with an external database — see section 7 |
| Search returns nothing | Elasticsearch is intentionally disabled | Expected when `ELASTICSEARCH_NODE=` is empty |
| Database looks empty in pgAdmin/DBeaver | Stale tree, or looking at the wrong level | Right-click the database -> **Refresh**, then expand **Schemas -> public -> Tables** (~130 tables) |

## 7. Alternative: using your own PostgreSQL instead of the container

Only needed if you must point the app at a PostgreSQL server already installed on your machine. The
container path in section 3 is simpler and is what most people should use.

**1. Make your PostgreSQL reachable from containers.** A container sits on a virtual network with its
own IP, so a server listening only on `127.0.0.1` will refuse it. In your data directory
(for example `C:\Program Files\PostgreSQL\18\data`), as Administrator:

- `postgresql.conf`: set `listen_addresses = '*'`
- `pg_hba.conf`, appended — scope it to Docker's ranges rather than using `0.0.0.0/0`:
  ```
  host    all    all    172.16.0.0/12      scram-sha-256
  host    all    all    192.168.65.0/24    scram-sha-256
  ```
- Restart the PostgreSQL service, and allow the port inbound in Windows Firewall.

**2. Point the app at the host** using `host.docker.internal`, the Docker Desktop DNS name for your
machine, with your real port and database:

```env
DATABASE_URL="postgresql://<user>:<password>@host.docker.internal:<port>/<database>?schema=public"
POSTGRES_HOST=host.docker.internal
POSTGRES_PORT=<port>
```

Verify connectivity before building — this takes seconds and saves a wasted 20-minute build:

```powershell
docker run --rm postgres:18-alpine psql "postgresql://<user>:<password>@host.docker.internal:<port>/<database>" -c "SELECT 1;"
```

**3. Override the workers' database wait.** The workers image bakes its wait target in at build time
as `postgres:5432` with no environment override, so with an external database they hang forever.
Create `testplanit/docker-compose.local.yml`:

```yaml
services:
  workers:
    command:
      - /bin/sh
      - -c
      - |
        set -e
        /usr/local/bin/wait-for-postgres.sh "${POSTGRES_HOST}" "${POSTGRES_PORT}"
        tsx scheduler.ts
        pm2-runtime start ecosystem.config.js
```

This file is intentionally git-ignored (the `docker-compose.*.yml` pattern), because local overrides
are machine-specific — create it yourself rather than expecting it in the repository.

**4. Run without the bundled database.** Add the override file (order matters — it must come second)
and drop the `with-postgres` profile:

```powershell
$C = "docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.local.yml --profile with-valkey --profile with-minio"
```

Then follow section 3 from "Build the images", skipping `postgres` in the services step.

---

## Further documentation

The upstream project documentation is at
[docs.testplanit.com](https://docs.testplanit.com/docs/installation) and covers development
(non-Docker) setup, background workers, and file-storage configuration.

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on how to get started.

## License

TestPlanIt is available under a dual license model. See [LICENSE.md](LICENSE.md) for details.
