/**
 * 文件用途：数据库连接管理（TypeORM DataSource）。
 *
 * 主要职责：
 * - 按运行时配置创建 MySQL DataSource（host/port/user/password/database）。
 * - 采用 Promise 缓存的方式在进程内复用同一个连接池，避免并发请求重复初始化。
 *
 * 注意事项：
 * - 本文件只提供连接能力，不包含任何业务查询逻辑；业务查询由 tools/schema/agent 层完成。
 * - 配置缺失或连接失败会在初始化阶段抛出异常，由上层 API 统一处理。
 */
import { DataSource } from "typeorm";

function secretSig(v: unknown, headLen = 2) {
  const s = String(v ?? "");
  const head = s.slice(0, Math.max(0, headLen));
  return `${s.length}:${head}`;
}

const dataSourcePromiseByKey = new Map<string, Promise<DataSource>>();
const DATA_SOURCE_CACHE_MAX = 2;

export function getDataSource(config: {
  dbId?: string;
  mysql: { host: string; port: number; user: string; password: string; database: string };
}) {
  const key = [
    String(config.dbId ?? ""),
    String(config.mysql?.host ?? ""),
    String(config.mysql?.port ?? ""),
    String(config.mysql?.user ?? ""),
    String(config.mysql?.database ?? ""),
    secretSig(config.mysql?.password, 2),
  ].join("|");

  const cached = dataSourcePromiseByKey.get(key);
  if (cached) return cached;

  const promise = new DataSource({
    type: "mysql",
    host: String(config.mysql.host),
    port: Number(config.mysql.port),
    username: String(config.mysql.user),
    password: String(config.mysql.password ?? ""),
    database: String(config.mysql.database),
    charset: "utf8mb4",
    supportBigNumbers: true,
    bigNumberStrings: true,
    extra: {
      dateStrings: true,
    },
  }).initialize();

  dataSourcePromiseByKey.set(key, promise);
  if (dataSourcePromiseByKey.size > DATA_SOURCE_CACHE_MAX) {
    const firstKey = dataSourcePromiseByKey.keys().next().value;
    if (firstKey) {
      const evicted = dataSourcePromiseByKey.get(firstKey);
      dataSourcePromiseByKey.delete(firstKey);
      try {
        void evicted?.then((ds) => ds.destroy()).catch(() => {});
      } catch {}
    }
  }
  return promise;
}
