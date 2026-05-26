{{- define "nrdc-poc.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "nrdc-poc.namespace" -}}
{{- .Values.global.namespace }}
{{- end }}

{{- define "nrdc-poc.labels" -}}
app.kubernetes.io/part-of: nrdc-poc
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
