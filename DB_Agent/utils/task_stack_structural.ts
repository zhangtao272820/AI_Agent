/**
 * 多步问句结构性切分（连接词定位，非业务正则分类）。
 */
const SEQ_MARKERS = ["再", "然后", "接着", "之后"] as const;

export function splitSequentialQuestion(question: string): { first: string; second: string } | null {
  const text = String(question ?? "").trim();
  if (text.length < 8) return null;
  const idxStart = text.indexOf("先");
  if (idxStart < 0) return null;

  let splitAt = -1;
  let markerLen = 0;
  for (const marker of SEQ_MARKERS) {
    const i = text.indexOf(marker, idxStart + 1);
    if (i > 0 && (splitAt < 0 || i < splitAt)) {
      splitAt = i;
      markerLen = marker.length;
    }
  }
  if (splitAt < 0) return null;

  const first = text.slice(idxStart + 1, splitAt).trim();
  const second = text.slice(splitAt + markerLen).trim();
  if (first.length < 4 || second.length < 4) return null;
  return { first, second };
}
