{{/*
Expand the name of the chart.
*/}}
{{- define "testplanit.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name.
*/}}
{{- define "testplanit.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "testplanit.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to all objects.
*/}}
{{- define "testplanit.labels" -}}
helm.sh/chart: {{ include "testplanit.chart" . }}
{{ include "testplanit.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Chart.AppVersion }}
app.kubernetes.io/version: {{ . | quote }}
{{- end }}
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Selector labels (stable identity for the release).
*/}}
{{- define "testplanit.selectorLabels" -}}
app.kubernetes.io/name: {{ include "testplanit.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Component-scoped selector labels. Usage: include "testplanit.componentSelectorLabels" (dict "root" $ "component" "server")
*/}}
{{- define "testplanit.componentSelectorLabels" -}}
{{ include "testplanit.selectorLabels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
ServiceAccount name.
*/}}
{{- define "testplanit.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "testplanit.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Name of the Secret holding the app's secret env.
*/}}
{{- define "testplanit.secretName" -}}
{{- if .Values.secrets.existingSecret }}
{{- .Values.secrets.existingSecret }}
{{- else }}
{{- printf "%s-env" (include "testplanit.fullname" .) }}
{{- end }}
{{- end }}

{{- define "testplanit.configMapName" -}}
{{- printf "%s-config" (include "testplanit.fullname" .) }}
{{- end }}

{{/*
Server image reference. Defaults come from values.yaml (the public self-host
image); required guards only fire if someone explicitly blanks them.
*/}}
{{- define "testplanit.serverImage" -}}
{{- $repo := required "image.repository must be set" .Values.image.repository -}}
{{- $tag := required "image.tag must be set" .Values.image.tag -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end }}

{{/*
Workers image reference. Defaults to "<repository>:<tag>-workers".
*/}}
{{- define "testplanit.workersImage" -}}
{{- $repo := default .Values.image.repository .Values.image.workersRepository -}}
{{- $repo = required "image.repository (or image.workersRepository) must be set" $repo -}}
{{- $tag := .Values.image.workersTag -}}
{{- if not $tag -}}
{{- $tag = printf "%s-workers" (required "image.tag must be set" .Values.image.tag) -}}
{{- end -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end }}

{{/*
imagePullSecrets block.
*/}}
{{- define "testplanit.imagePullSecrets" -}}
{{- with .Values.image.pullSecrets }}
imagePullSecrets:
{{- toYaml . | nindent 0 }}
{{- end }}
{{- end }}

{{/*
Bundled datastore object names / in-cluster hostnames.
*/}}
{{- define "testplanit.postgresql.fullname" -}}{{ printf "%s-postgresql" (include "testplanit.fullname" .) }}{{- end }}
{{- define "testplanit.redis.fullname" -}}{{ printf "%s-valkey" (include "testplanit.fullname" .) }}{{- end }}
{{- define "testplanit.elasticsearch.fullname" -}}{{ printf "%s-elasticsearch" (include "testplanit.fullname" .) }}{{- end }}
{{- define "testplanit.minio.fullname" -}}{{ printf "%s-minio" (include "testplanit.fullname" .) }}{{- end }}

{{/*
Computed ELASTICSEARCH_NODE ("" => search disabled).
*/}}
{{- define "testplanit.elasticsearchNode" -}}
{{- if .Values.elasticsearch.enabled -}}
http://{{ include "testplanit.elasticsearch.fullname" . }}:9200
{{- else -}}
{{ .Values.elasticsearch.external.node }}
{{- end -}}
{{- end }}
