---
title: Migrating from MinIO to RustFS
---

# Migrating from MinIO to RustFS

MinIO no longer publishes Docker images, so new installs could no longer pull
the file storage that TestPlanIt bundled. TestPlanIt's bundled file storage is
now [RustFS](https://github.com/rustfs/rustfs), an open-source (Apache-2.0)
S3-compatible server. Attachments, inline images, avatars and project icons all
live in this storage.

## Do I need to migrate?

| Your setup | What to do |
| --- | --- |
| Docker Compose with the bundled storage (the `with-minio` profile of `docker-compose.prod.yml`, or the `prod` profile of `docker-compose.yml`) | Follow [Docker Compose](#docker-compose) below. |
| Kubernetes with the Helm chart's bundled storage (`objectStorage.minio.enabled: true`, the default) | Follow [Kubernetes (Helm)](#kubernetes-helm) below. |
| AWS S3 or another external S3-compatible service | Nothing. Your storage is unaffected. |
| A new install | Nothing. New installs use RustFS automatically. |

## Docker Compose

Your files stay in `./docker-data/minio`. The new storage keeps its files in
`./docker-data/rustfs`, and a migration script copies everything across and
verifies each file. The old directory is only read, never changed, so it
remains a complete backup.

The steps below use `docker-compose.prod.yml` with the `with-minio` profile.
Add the other profiles you normally use (for example `--profile with-postgres`)
to each `docker compose` command.

### 1. Back up your files

```bash
cd testplanit
sudo tar -czf minio-backup.tar.gz docker-data/minio
```

### 2. Update TestPlanIt

Update your checkout to the new release as you normally do (for example
`git pull`), then rebuild:

```bash
docker compose -f docker-compose.prod.yml --profile with-minio build
```

### 3. Run the migration

From the `testplanit` directory:

```bash
./scripts/migrate-minio-to-rustfs.sh
```

The script stops TestPlanIt, starts the old MinIO storage from the `minio/minio`
image that is still on your server, copies every bucket into RustFS, and then
compares every file on both sides. It ends with:

```text
Migration complete. Every file was copied and verified.
```

You can run the script again safely; files that were already copied are
skipped.

If you use `docker-compose.yml` instead, run:

```bash
STORAGE_COMPOSE_FILE=docker-compose.yml STORAGE_PROFILE=prod ./scripts/migrate-minio-to-rustfs.sh
```

If you changed the MinIO root user or password from the defaults, pass them in
`LEGACY_MINIO_ROOT_USER` and `LEGACY_MINIO_ROOT_PASSWORD` when running the
script.

### 4. Start TestPlanIt

```bash
docker compose -f docker-compose.prod.yml --profile with-minio up -d
```

Open a few test cases with attachments and check that images and files load.

### 5. Remove the old files

Once you have confirmed your files, delete the old storage to free the disk
space:

```bash
sudo rm -rf docker-data/minio
```

Keep `minio-backup.tar.gz` until you are confident everything is in place.

### If TestPlanIt does not start after updating

If you start TestPlanIt before migrating, it stops before the app comes up so
that it never looks as if your files were lost. `docker compose up` reports
that the `minio-init` service did not complete, and its log explains why:

```bash
docker compose -f docker-compose.prod.yml --profile with-minio logs minio-init
```

```text
 ACTION REQUIRED: migrate your files from MinIO to RustFS
```

Run the migration in step 3, then start TestPlanIt again.

### Migrating without the MinIO image

The migration script needs the `minio/minio` image that your server used
before the update. If that image is no longer on your server, the script says
so and stops. RustFS can serve a copy of the MinIO data directory directly
instead:

```bash
docker compose -f docker-compose.prod.yml --profile with-minio stop minio
sudo rm -rf docker-data/rustfs
sudo cp -a docker-data/minio docker-data/rustfs
docker compose -f docker-compose.prod.yml --profile with-minio up -d
```

This works for the single-drive layout that TestPlanIt's Docker Compose files
created. RustFS adds its own metadata to the copy, so always copy the
directory; never point RustFS at `docker-data/minio` itself.

### Starting without migrating

To start TestPlanIt with an empty storage on purpose, set this in
`.env.production` (or in your shell for `docker-compose.yml`):

```bash
STORAGE_MIGRATION_SKIP=true
```

Files uploaded before the update are then missing from TestPlanIt until you
migrate them.

## Kubernetes (Helm)

The chart keeps the same `objectStorage.minio` values, Service, Secret keys
and ingress path, and RustFS serves your existing files from the same
persistent volume, so no copy is needed. RustFS writes its own metadata next to
MinIO's, and MinIO cannot read the volume afterwards, so take a snapshot first.

1. Find the storage volume and snapshot it with your storage provider's
   VolumeSnapshot or backup tool. By default it is named
   `data-<release>-testplanit-minio-0`:

   ```bash
   kubectl -n <namespace> get pvc | grep minio
   ```

2. If your values file pins `objectStorage.minio.image` to a MinIO image,
   remove that line.

3. Upgrade the release:

   ```bash
   helm upgrade <release> testplanit/testplanit -f my-values.yaml
   ```

4. Open a few test cases with attachments and check that images and files load.

## The storage console

RustFS includes a web console on the same port the MinIO console used (`9001`
by default, set with `DOCKER_MINIO_CONSOLE_PORT`). Sign in with the same
access key and secret as before (`minioadmin` / `minioadmin123` unless you
changed them).

## Rolling back

Your MinIO files are untouched until you delete them. To go back, check out the
previous TestPlanIt release, which uses `./docker-data/minio` again. This only
works while the `minio/minio` image is still on your server, because it can no
longer be downloaded. On Kubernetes, restore the volume snapshot and the
previous chart release; the cluster needs the MinIO image cached for the same
reason.
