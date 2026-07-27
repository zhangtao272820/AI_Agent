/**
 * @deprecated 请从 `./person` 导入；本文件为向后兼容 shim。
 */
export type { PersonInfoStatFilters } from "./person";
export {
  parsePersonStatFilters,
  personInfoStatsEligible,
  tryPersonInfoFilteredStats,
  runPersonInfoStatsFastPath,
} from "./person";
