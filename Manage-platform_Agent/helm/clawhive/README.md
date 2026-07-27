# ClawHive Helm chart (P2a + P2b)

标准协作链：平台 + DB/RAG/Code/Extractor/Admin/Manager + 可选监控 + HPA / LiteLLM / Langfuse。

## 前提

- Kubernetes 1.25+
- Helm 3
- 已构建并推送（或 kind load）镜像 `clawhive/*:<tag>`（与 Compose `CLAWHIVE_IMAGE_TAG` 一致）
- **HPA**：集群需安装 [metrics-server](https://github.com/kubernetes-sigs/metrics-server)；无 metrics-server 时可将 `agents.*.autoscaling.enabled=false`

## 安装

```bash
cd Manage-platform_Agent
kubectl create namespace clawhive
helm upgrade --install clawhive ./helm/clawhive \
  --namespace clawhive \
  --set image.tag=0.1.0-<gitsha> \
  --set secrets.clawhiveInternalToken=<token> \
  --set secrets.openaiApiKey=<key>
```

弱机关监控：

```bash
helm upgrade --install clawhive ./helm/clawhive -n clawhive --set monitoring.enabled=false
```

启用 LiteLLM 出口网关：

```bash
helm upgrade --install clawhive ./helm/clawhive -n clawhive \
  --set litellm.enabled=true \
  --set secrets.openaiApiKey=<dashscope-or-upstream-key>
```

## 验收

1. `helm lint ./helm/clawhive`
2. `helm template clawhive ./helm/clawhive | grep -E 'kind: HorizontalPodAutoscaler|kind: Deployment'`
3. 安装后：`curl http://<node>:18000/health/ready`
4. `kubectl -n clawhive get hpa` 应列出各 Agent
5. 打开 `http://<node>:18073`，在 Agent 管控 stop/start `DB_Agent`，确认 Deployment replicas 回到 HPA `minReplicas`（默认 1）
6. （可选）LiteLLM：`--set litellm.enabled=true` 后 Agent `OPENAI_BASE_URL` 指向 `http://litellm:4000/v1`
7. （可选）Langfuse：监控开启时 NodePort `13001`；控制台 trace 深链含 Langfuse

## 控制面

- backend `AGENT_CONTROL_MODE=kubernetes`
- ServiceAccount + Role 可 patch Deployments / scale，可读 HPA
- **不挂载 docker.sock**

Compose LAN 路径不变（`AGENT_CONTROL_MODE=docker`）。
