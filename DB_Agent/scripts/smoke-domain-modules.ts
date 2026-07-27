/**
 * D-P2-4 / D-P2-3 smoke：域模块拆分 + legacy blueprint 下线。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = dirname(fileURLToPath(import.meta.url));
const utils = join(root, "../utils");

const toolsShim = readFileSync(join(utils, "tools.ts"), "utf8");
assert(toolsShim.includes('from "./tools/index"'), "tools.ts is shim");
assert(toolsShim.split("\n").length < 25, "tools.ts shim stays thin");

const sqlShim = readFileSync(join(utils, "sql_direct.ts"), "utf8");
assert(sqlShim.includes('from "./sql/direct"'), "sql_direct.ts is shim");

assert(existsSync(join(utils, "tools/personQuery.ts")), "utils/tools/personQuery.ts exists");
assert(existsSync(join(utils, "sql/direct/runSqlDirect.ts")), "utils/sql/direct/runSqlDirect.ts exists");

const blueprintCfg = readFileSync(join(utils, "blueprint_config.ts"), "utf8");
assert(!blueprintCfg.includes("data/db-blueprint.json"), "legacy data/db-blueprint.json path removed");

const domainPatch = readFileSync(join(utils, "domain_patch.ts"), "utf8");
assert(!domainPatch.includes("data/db-blueprint.json"), "domain_patch legacy fallback removed");

assert(!existsSync(join(root, "../data/db-blueprint.json")), "data/db-blueprint.json deleted");

const skillsDoc = readFileSync(join(root, "../doc/db-agent-skills-boundary.md"), "utf8");
assert(skillsDoc.includes("skills/"), "skills boundary doc exists");
assert(skillsDoc.includes(".trae/skills/"), "skills boundary doc covers .trae");

console.log("smoke-domain-modules: OK");
