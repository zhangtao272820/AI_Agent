/**
 * 业务查询工具集 shim — 实现已迁至 utils/tools/。
 * @deprecated 请从 `./tools/` 导入。
 */
export {
  maskPhone,
  extractPersonName,
  extractPersonAttribute,
  queryPersonFullInfoTool,
  answerPersonQuery,
  resolvePersonId,
  queryPersonHealthRecordsTool,
  queryFootPressureReportTool,
  statisticsToolRaw,
  statisticsTool,
  type StatisticsResult,
} from "./tools/index";
