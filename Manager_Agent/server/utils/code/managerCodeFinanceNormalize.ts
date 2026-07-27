/**
 * @deprecated 已合并至 managerCodeAuthorityNormalize / managerCodeAuthorityLlm（通用 Code 权威管线）。
 * 保留仅为兼容旧 import，请勿在新代码中使用。
 */
export {
  normalizeCodeOutputAsync as normalizeCodeFinanceOutputAsync,
  assessCodeDownstreamConsistencyAsync as assessCodeFinanceConsistencyAsync,
  normalizeCodeOutputAsync as normalizeCodeFinanceOutput,
  shouldEnrichCodeByLlm
} from './managerCodeAuthorityNormalize'
