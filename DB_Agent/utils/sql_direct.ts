/**
 * 结构化 SQL 快路径 shim — 实现已迁至 utils/sql/direct/。
 * @deprecated 请从 `./sql/direct` 导入。
 */
export type { SqlDirectResult } from "./sql/direct";
export {
  runSqlDirectDetailFastPath,
  runDetailRecordFastPaths,
  runSqlDirect,
  runScalarLookupDirect,
} from "./sql/direct";
