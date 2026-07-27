/**
 * 云抓取通道（原 MCP 命名）：第三方 HTTP 渲染/反爬 API，非 Model Context Protocol。
 * 环境变量仍使用 MCP_* 前缀以保持总管/Compose 向后兼容。
 */
export {
  fetchViaMcp as fetchViaCloudScrape,
  isCloudScrapeConfigured,
} from './runtime'
