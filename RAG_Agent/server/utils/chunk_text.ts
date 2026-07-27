import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { Document } from "@langchain/core/documents";
import { getRagAgentEnv } from "./rag_agent_env";

const HEADING_RE = /^(#{1,6}\s+.+|[\d一二三四五六七八九十]+[、.．]\s*.+|第[一二三四五六七八九十\d]+[章节条]\s*.+)$/m;
const MD_TABLE_ROW_RE = /^\|.+\|$/;
const MD_TABLE_SEP_RE = /^\|[\s\-:|]+\|$/;
const TSV_ROW_RE = /^[^\n]+\t[^\n]+\t[^\n]+/;

const isMarkdownTableRow = (line: string) => MD_TABLE_ROW_RE.test(line.trim());
const isMarkdownTableSep = (line: string) => MD_TABLE_SEP_RE.test(line.trim());
const isTsvRow = (line: string) => TSV_ROW_RE.test(line.trim());

type ContentBlock = { kind: "prose" | "table"; lines: string[] };

/** 将文本拆成 prose / table 块，表格行尽量保持连续 */
function splitProseAndTableBlocks(text: string): ContentBlock[] {
  const lines = String(text ?? "").split("\n");
  const blocks: ContentBlock[] = [];
  let current: ContentBlock | null = null;

  const flush = () => {
    if (current && current.lines.length) blocks.push(current);
    current = null;
  };

  for (const raw of lines) {
    const line = raw ?? "";
    const trimmed = line.trim();
    const tableLike =
      isMarkdownTableRow(trimmed) ||
      isMarkdownTableSep(trimmed) ||
      (trimmed.length > 0 && isTsvRow(trimmed));

    if (tableLike) {
      if (!current || current.kind !== "table") {
        flush();
        current = { kind: "table", lines: [line] };
      } else {
        current.lines.push(line);
      }
      continue;
    }

    if (!current || current.kind !== "prose") {
      flush();
      current = { kind: "prose", lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  flush();
  return blocks.filter((b) => b.lines.join("\n").trim().length >= 8);
}

/** 表格按行分组切分，每组保留表头 */
function chunkTableLines(lines: string[], chunkSize: number, rowsPerChunk: number): string[] {
  const body = lines.filter((l) => !isMarkdownTableSep(l.trim()));
  if (body.length <= 1) return [body.join("\n")];

  const header = body[0]!;
  const dataRows = body.slice(1);
  const chunks: string[] = [];
  for (let i = 0; i < dataRows.length; i += rowsPerChunk) {
    const group = dataRows.slice(i, i + rowsPerChunk);
    const block = [header, ...group].join("\n");
    if (block.length <= chunkSize * 1.15) {
      chunks.push(block);
    } else {
      for (const row of group) {
        chunks.push([header, row].join("\n"));
      }
    }
  }
  return chunks.filter((c) => c.trim().length >= 8);
}

function tableRowsPerChunk(chunkSize: number) {
  return Math.max(4, Math.min(16, Math.floor(chunkSize / 80)));
}

/** 表格块 → 带 chunkType=table 的 Document 列表 */
function documentsFromTableBlock(block: ContentBlock, meta: Record<string, unknown>, chunkSize: number): Document[] {
  const rowsPerChunk = tableRowsPerChunk(chunkSize);
  const parts = chunkTableLines(block.lines, chunkSize, rowsPerChunk);
  return parts.map((part, i) => ({
    pageContent: part,
    metadata: {
      ...meta,
      chunkType: "table",
      tablePartIndex: i,
    },
  })) as Document[];
}

/** 按标题/条款边界预切，再 RecursiveCharacter 细切，减少语义断裂 */
export async function splitDocumentsStructured(docs: Document[]): Promise<Document[]> {
  const env = getRagAgentEnv();
  if (!env.structureAwareChunking) {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: env.chunkSize,
      chunkOverlap: env.chunkOverlap,
    });
    return splitter.splitDocuments(docs);
  }

  const sections: Document[] = [];
  for (const doc of docs) {
    const text = String(doc.pageContent ?? "");
    const meta = doc.metadata ?? {};
    if (!text.trim()) continue;

    const useTableAware = env.enableTableAwareChunking;
    const preBlocks = useTableAware ? splitProseAndTableBlocks(text) : null;

    if (preBlocks && preBlocks.some((b) => b.kind === "table")) {
      for (const block of preBlocks) {
        if (block.kind === "table") {
          sections.push(...documentsFromTableBlock(block, meta, env.chunkSize));
          continue;
        }
        const prose = block.lines.join("\n").trim();
        if (prose.length < 20) continue;
        sections.push({ pageContent: prose, metadata: { ...meta } } as Document);
      }
      continue;
    }

    const blocks = text.split(/\n(?=#{1,6}\s+|\d+[、.．]\s+|第[一二三四五六七八九十\d]+[章节条])/);
    const parts =
      blocks.length > 1
        ? blocks.map((b) => b.trim()).filter((b) => b.length >= 20)
        : text.split(/\n{2,}/).map((b) => b.trim()).filter((b) => b.length >= 40);

    if (parts.length <= 1) {
      sections.push(doc);
      continue;
    }

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const heading = part.match(HEADING_RE)?.[0]?.trim();
      sections.push({
        pageContent: part,
        metadata: {
          ...meta,
          sectionIndex: i,
          ...(heading ? { sectionHeading: heading.slice(0, 120) } : {}),
        },
      } as Document);
    }
  }

  const proseSections = sections.filter((s) => String(s.metadata?.chunkType ?? "") !== "table");
  const tableSections = sections.filter((s) => String(s.metadata?.chunkType ?? "") === "table");

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: env.chunkSize,
    chunkOverlap: env.chunkOverlap,
  });
  const splitProse = proseSections.length ? await splitter.splitDocuments(proseSections) : [];
  return [...tableSections, ...splitProse];
}
