{{/*
envFrom block shared by the app, workers, and migrate job.
*/}}
{{- define "testplanit.appEnvFrom" -}}
envFrom:
  - configMapRef:
      name: {{ include "testplanit.configMapName" . }}
  - secretRef:
      name: {{ include "testplanit.secretName" . }}
{{- end }}

{{/*
init container: block until the database accepts TCP connections. Parses host
and port out of the connection URL and does a plain TCP check with nc, so
Prisma-only query params (?schema=, ?pgbouncer=, …) don't matter and no database
user/credentials are needed (pg_isready needs a resolvable OS user, which a
random pod UID doesn't have). Works for bundled and external DBs alike. Startup
ordering is otherwise handled by the migrate Helm hook (which helm waits for) and
the app's /api/health readiness probe.

Usage: include "testplanit.initWaitForDb" (dict "root" $)
*/}}
{{- define "testplanit.initWaitForDb" -}}
{{- $root := .root -}}
- name: wait-for-db
  image: {{ $root.Values.postgresql.image }}
  imagePullPolicy: {{ $root.Values.postgresql.imagePullPolicy }}
  command:
    - /bin/sh
    - -c
    - |
      set -eu
      DB="${DIRECT_DATABASE_URL:-$DATABASE_URL}"
      rest="${DB#*://}"        # strip scheme
      rest="${rest#*@}"         # strip credentials (if any)
      hostport="${rest%%/*}"    # host:port
      HOST="${hostport%%:*}"
      PORT="${hostport##*:}"
      case "$PORT" in ''|*[!0-9]*) PORT=5432 ;; esac
      echo "Waiting for database at $HOST:$PORT..."
      until nc -z -w2 "$HOST" "$PORT" >/dev/null 2>&1; do sleep 2; done
      echo "Database ready."
  env:
    - name: DATABASE_URL
      valueFrom:
        secretKeyRef:
          name: {{ include "testplanit.secretName" $root }}
          key: DATABASE_URL
    - name: DIRECT_DATABASE_URL
      valueFrom:
        secretKeyRef:
          name: {{ include "testplanit.secretName" $root }}
          key: DIRECT_DATABASE_URL
          optional: true
  securityContext:
    allowPrivilegeEscalation: false
    capabilities:
      drop: ["ALL"]
  resources:
    requests:
      cpu: 25m
      memory: 32Mi
    limits:
      cpu: 250m
      memory: 128Mi
{{- end }}
