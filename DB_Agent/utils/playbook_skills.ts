/**
 * Playbook Skill 加载器：从 skills/<id>/skill.md 读取流程规范（SSOT）。
 * 与 .trae/skills/ 下的 domain skill（带 run()）分离。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const cache = new Map<string, string>();

/** 去掉 YAML frontmatter，返回正文 */
export function stripPlaybookFrontmatter(raw: string): string {
  const text = String(raw ?? "");
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return text.trim();
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      return lines.slice(i + 1).join("\n").trim();
    }
  }
  return text.trim();
}

/** 读取 skills/<skillId>/skill.md 全文正文（无 frontmatter） */
export function loadPlaybookBody(skillId: string): string {
  const key = `body:${skillId}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const p = join(process.cwd(), "skills", skillId, "skill.md");
  try {
    if (!existsSync(p)) {
      cache.set(key, "");
      return "";
    }
    const body = stripPlaybookFrontmatter(readFileSync(p, "utf8"));
    cache.set(key, body);
    return body;
  } catch {
    cache.set(key, "");
    return "";
  }
}

/**
 * 读取 skill.md 中 `## heading` 段落正文（不含标题行）。
 * heading 示例：`Preflight`、`Direct`（不含 ##）
 */
export function loadPlaybookSection(skillId: string, heading: string): string {
  const key = `section:${skillId}:${heading}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const body = loadPlaybookBody(skillId);
  if (!body) {
    cache.set(key, "");
    return "";
  }

  const h = String(heading ?? "").trim().replace(/^#+\s*/, "");
  const blocks = body.split(/\r?\n(?=## )/);
  for (const block of blocks) {
    const m = block.match(/^##\s+(.+?)\s*\r?\n([\s\S]*)$/);
    if (m && m[1]?.trim() === h) {
      const section = (m[2] ?? "").trim();
      cache.set(key, section);
      return section;
    }
  }
  cache.set(key, "");
  return "";
}

/** 优先 skill.md，否则 inline 兜底（Phase B 过渡期保安全） */
export function resolvePlaybookOrFallback(skillId: string, fallback: string): string {
  const fromSkill = loadPlaybookBody(skillId);
  return fromSkill.trim() ? fromSkill.trim() : fallback;
}

export function resolvePlaybookSectionOrFallback(
  skillId: string,
  heading: string,
  fallback: string,
): string {
  const fromSkill = loadPlaybookSection(skillId, heading);
  return fromSkill.trim() ? fromSkill.trim() : fallback;
}

/** 测试或热更新时清缓存 */
export function clearPlaybookCache(): void {
  cache.clear();
}
