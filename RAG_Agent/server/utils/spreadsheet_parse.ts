import * as XLSX from "xlsx";

/** 扩展名判断（不用正则） */
export function spreadsheetKind(fileName: string): "xlsx" | "xls" | null {
  const lower = String(fileName || "").trim().toLowerCase();
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".xls")) return "xls";
  return null;
}

/** 将工作簿各 sheet 转为 TSV 文本，供分块与向量入库 */
export function parseSpreadsheetBuffer(buffer: Buffer, fileName: string): string {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { FS: "\t" });
    const body = String(csv || "").trim();
    if (!body) continue;
    parts.push(`## Sheet: ${sheetName}\n${body}`);
  }
  const joined = parts.join("\n\n").trim();
  if (!joined) {
    throw new Error(`Spreadsheet ${fileName} has no readable cell data`);
  }
  return joined;
}
