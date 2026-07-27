#!/bin/sh
# Alertmanager entrypoint: inject Bearer token + optional external webhook.
set -eu
printf '%s' "${CLAWHIVE_INTERNAL_TOKEN:-}" > /tmp/clawhive_am_token
CFG=/tmp/alertmanager.runtime.yml

if [ -n "${CLAWHIVE_ALERT_WEBHOOK_URL:-}" ]; then
  cat > "$CFG" <<EOF
global:
  resolve_timeout: 5m
route:
  receiver: clawhive-fanout
  group_by: ["alertname", "severity"]
  group_wait: 15s
  group_interval: 2m
  repeat_interval: 4h
receivers:
  - name: clawhive-fanout
    webhook_configs:
      - url: "http://clawhive_backend:8000/api/monitor/alertmanager/webhook"
        send_resolved: false
        http_config:
          authorization:
            type: Bearer
            credentials_file: /tmp/clawhive_am_token
      - url: "${CLAWHIVE_ALERT_WEBHOOK_URL}"
        send_resolved: false
EOF
else
  cp /etc/alertmanager/alertmanager.yml "$CFG"
fi

exec /bin/alertmanager --config.file="$CFG" --storage.path=/alertmanager
