/**
 * P8 可选 ONNX 重排：需安装 onnxruntime-node 并配置 RAG_ONNX_RERANK_MODEL 路径。
 * 未安装依赖或模型不存在时静默回退到 embedding / 本地重排。
 */
import { existsSync } from "fs";
import { getRagAgentEnv } from "./rag_agent_env";
import type { CrossEncoderRankedDoc } from "./cross_encoder_rerank";

let session: { run: (feeds: Record<string, unknown>) => Promise<unknown[]> } | null = null;
let loadFailed = false;

async function getOnnxSession() {
  if (loadFailed) return null;
  const modelPath = String(process.env.RAG_ONNX_RERANK_MODEL ?? "").trim();
  if (!modelPath || !existsSync(modelPath)) return null;
  if (session) return session;
  try {
    const ort = await import(/* @vite-ignore */ "onnxruntime-node");
    session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ["cpu"],
    });
    return session;
  } catch (e) {
    loadFailed = true;
    console.warn("[OnnxRerank] unavailable (install onnxruntime-node + set RAG_ONNX_RERANK_MODEL):", e);
    return null;
  }
}

/**
 * 通用 ONNX CE 网关：期望 input_ids / attention_mask，logits 输出 relevance。
 * 生产请配齐 tokenizer 服务或换用 embedding_rerank。
 */
export async function onnxRerankCandidates<T extends { pageContent?: string }>(
  _query: string,
  _docs: T[],
  _topN = 8
): Promise<CrossEncoderRankedDoc<T>[] | null> {
  const env = getRagAgentEnv();
  if (!env.enableOnnxRerank) return null;
  const s = await getOnnxSession();
  if (!s) return null;
  // 完整 tokenizer + ORT 推理待模型资产就绪后接入；当前仅占位探测加载能力
  return null;
}

export function getOnnxRerankStatus() {
  const env = getRagAgentEnv();
  const modelPath = String(process.env.RAG_ONNX_RERANK_MODEL ?? "").trim();
  return {
    enabled: env.enableOnnxRerank,
    modelConfigured: Boolean(modelPath),
    modelExists: modelPath ? existsSync(modelPath) : false,
    sessionReady: Boolean(session),
    loadFailed,
  };
}
