{{- define "clawhive.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "clawhive.fullname" -}}
{{- default .Release.Namespace .Values.namespace -}}
{{- end -}}

{{- define "clawhive.labels" -}}
app.kubernetes.io/name: {{ include "clawhive.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "clawhive.imageTag" -}}
{{- .Values.image.tag | default "prod" -}}
{{- end -}}
