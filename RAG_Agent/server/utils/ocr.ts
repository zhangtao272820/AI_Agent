import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";

/**
 * OCR 识别工具类
 * 使用架构中提到的 LLM (如 qwen-vl) 进行文字识别
 */
export const performOCR = async (imageBuffer: Buffer, fileName: string): Promise<string> => {
  console.log(`[OCR] Starting OCR for: ${fileName}, Buffer size: ${imageBuffer.length}`);

  const maxImageBytes = parseInt(process.env.MAX_OCR_IMAGE_BYTES ?? "10485760");
  const maxInputBytes = parseInt(process.env.MAX_OCR_INPUT_BYTES ?? "31457280");
  if (imageBuffer.length > maxImageBytes) {
    if (imageBuffer.length > maxInputBytes) {
      throw new Error(`OCR image too large: ${imageBuffer.length} > ${maxInputBytes}`);
    }
  }
  const timeoutMs = parseInt(process.env.OCR_TIMEOUT_MS ?? "20000");
  const maxBase64Chars = parseInt(process.env.MAX_OCR_BASE64_CHARS ?? "12000000");
  const maxPixels = parseInt(process.env.MAX_OCR_PIXELS ?? "12000000");
  const ocrModel = process.env.OCR_MODEL ?? process.env.OPENAI_MODEL;
  const ocrDetail = process.env.OCR_IMAGE_DETAIL as "low" | "high" | "auto" | undefined;
  const ocrMaxDimension = parseInt(process.env.OCR_MAX_DIMENSION ?? "2000");
  const ocrOutputFormat = (process.env.OCR_OUTPUT_FORMAT ?? "jpeg") as "jpeg" | "webp" | "png";
  const ocrQuality = parseInt(process.env.OCR_OUTPUT_QUALITY ?? "72");
  const ocrMinQuality = parseInt(process.env.OCR_OUTPUT_MIN_QUALITY ?? "50");
  const sharpLimitInputPixels = parseInt(process.env.OCR_SHARP_LIMIT_INPUT_PIXELS ?? "45000000");

  const model = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    modelName: ocrModel, // 允许单独配置 OCR 专用视觉模型
    configuration: {
      baseURL: process.env.OPENAI_BASE_URL,
    },
    maxTokens: 4096, // OCR 可能产生大量文本
  });

  let workingMimeType = getMimeType(fileName);
  let workingBuffer = imageBuffer;
  let dims = getImageDimensions(workingBuffer, workingMimeType);

  const estimateBase64Chars = (bytes: number) => Math.ceil(bytes / 3) * 4;
  const pixels = dims && dims.width > 0 && dims.height > 0 ? dims.width * dims.height : null;

  const needsOptimize =
    workingBuffer.length > maxImageBytes ||
    (pixels !== null && pixels > maxPixels) ||
    estimateBase64Chars(workingBuffer.length) > maxBase64Chars ||
    (dims !== null && (dims.width > ocrMaxDimension || dims.height > ocrMaxDimension));

  if (needsOptimize) {
    const optimized = await optimizeImageForOCR({
      input: workingBuffer,
      inputMimeType: workingMimeType,
      maxBytes: Math.min(maxImageBytes, Math.floor(maxBase64Chars * 0.72)),
      maxPixels,
      maxDimension: ocrMaxDimension,
      outputFormat: ocrOutputFormat,
      quality: ocrQuality,
      minQuality: ocrMinQuality,
      sharpLimitInputPixels,
    });
    workingBuffer = optimized.buffer;
    workingMimeType = optimized.mimeType;
    dims = optimized.width && optimized.height ? { width: optimized.width, height: optimized.height } : getImageDimensions(workingBuffer, workingMimeType);
  }

  const finalPixels = dims && dims.width > 0 && dims.height > 0 ? dims.width * dims.height : null;
  if (finalPixels !== null && finalPixels > maxPixels) {
    throw new Error(`OCR image too many pixels: ${finalPixels} > ${maxPixels}`);
  }
  if (workingBuffer.length > maxImageBytes) {
    throw new Error(`OCR image too large after optimization: ${workingBuffer.length} > ${maxImageBytes}`);
  }
  if (estimateBase64Chars(workingBuffer.length) > maxBase64Chars) {
    throw new Error(`OCR request too large after optimization (base64 chars): ${estimateBase64Chars(workingBuffer.length)} > ${maxBase64Chars}`);
  }
  const base64Image = workingBuffer.toString("base64");

  try {
    const message = new HumanMessage({
      content: [
        {
          type: "text",
          text: "请识别这张图片中的所有文字，并以原始排版格式输出提取出的纯文本内容。不要包含任何额外的解释或 Markdown 格式，只输出识别到的文字。",
        },
        {
          type: "image_url",
          image_url: {
            url: `data:${workingMimeType};base64,${base64Image}`,
            ...(ocrDetail ? { detail: ocrDetail } : {}),
          },
        },
      ],
    });
    let timeoutId: NodeJS.Timeout | null = null;
    const response = await Promise.race([
      model.invoke([message]),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("OCR timeout")), timeoutMs);
      })
    ]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
    const text = response.content.toString().trim();
    
    console.log(`[OCR] Successfully extracted ${text.length} characters from ${fileName}`);
    return text;
  } catch (error: any) {
    console.error(`[OCR Error] Failed to process ${fileName}:`, error.message);
    throw new Error(`OCR 识别失败: ${error.message}`);
  }
};

/**
 * 根据文件名获取 MIME 类型
 */
function getMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "bmp": return "image/bmp";
    case "tiff": return "image/tiff";
    default: return "image/jpeg";
  }
}

function getImageDimensions(buffer: Buffer, mimeType: string): { width: number; height: number } | null {
  try {
    if (mimeType === "image/png") {
      if (buffer.length < 24) return null;
      const signature = buffer.subarray(0, 8);
      const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      if (!signature.equals(pngSig)) return null;
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }

    if (mimeType === "image/gif") {
      if (buffer.length < 10) return null;
      const header = buffer.subarray(0, 6).toString("ascii");
      if (header !== "GIF87a" && header !== "GIF89a") return null;
      const width = buffer.readUInt16LE(6);
      const height = buffer.readUInt16LE(8);
      return { width, height };
    }

    if (mimeType === "image/bmp") {
      if (buffer.length < 26) return null;
      if (buffer.subarray(0, 2).toString("ascii") !== "BM") return null;
      const dibHeaderSize = buffer.readUInt32LE(14);
      if (dibHeaderSize < 40 || buffer.length < 26) return null;
      const width = buffer.readInt32LE(18);
      const height = Math.abs(buffer.readInt32LE(22));
      return { width, height };
    }

    if (mimeType === "image/webp") {
      if (buffer.length < 30) return null;
      if (buffer.subarray(0, 4).toString("ascii") !== "RIFF") return null;
      if (buffer.subarray(8, 12).toString("ascii") !== "WEBP") return null;
      const chunkType = buffer.subarray(12, 16).toString("ascii");
      if (chunkType === "VP8X") {
        const widthMinusOne = buffer.readUIntLE(24, 3);
        const heightMinusOne = buffer.readUIntLE(27, 3);
        return { width: widthMinusOne + 1, height: heightMinusOne + 1 };
      }
      if (chunkType === "VP8 ") {
        if (buffer.length < 30) return null;
        const start = 20;
        const width = buffer.readUInt16LE(start + 6) & 0x3fff;
        const height = buffer.readUInt16LE(start + 8) & 0x3fff;
        return { width, height };
      }
      return null;
    }

    if (mimeType === "image/jpeg") {
      if (buffer.length < 4) return null;
      if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = buffer[offset + 1];
        const isSOF =
          marker === 0xc0 ||
          marker === 0xc1 ||
          marker === 0xc2 ||
          marker === 0xc3 ||
          marker === 0xc5 ||
          marker === 0xc6 ||
          marker === 0xc7 ||
          marker === 0xc9 ||
          marker === 0xca ||
          marker === 0xcb ||
          marker === 0xcd ||
          marker === 0xce ||
          marker === 0xcf;
        const blockLength = buffer.readUInt16BE(offset + 2);
        if (isSOF) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return { width, height };
        }
        if (blockLength < 2) return null;
        offset += 2 + blockLength;
      }
      return null;
    }

    return null;
  } catch {
    return null;
  }
}

async function optimizeImageForOCR(params: {
  input: Buffer;
  inputMimeType: string;
  maxBytes: number;
  maxPixels: number;
  maxDimension: number;
  outputFormat: "jpeg" | "webp" | "png";
  quality: number;
  minQuality: number;
  sharpLimitInputPixels: number;
}): Promise<{ buffer: Buffer; mimeType: string; width?: number; height?: number }> {
  const sharpModule = await import("sharp");
  const sharp = (sharpModule as any).default ?? sharpModule;

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  const estimateBase64Chars = (bytes: number) => Math.ceil(bytes / 3) * 4;

  let quality = clamp(params.quality, 35, 90);
  const minQuality = clamp(params.minQuality, 30, 85);
  let maxDimension = clamp(params.maxDimension, 512, 4096);

  const pickOutput = () => {
    if (params.outputFormat === "webp") return { format: "webp" as const, mimeType: "image/webp" };
    if (params.outputFormat === "png") return { format: "png" as const, mimeType: "image/png" };
    return { format: "jpeg" as const, mimeType: "image/jpeg" };
  };

  const output = pickOutput();

  const render = async () => {
    let image = sharp(params.input, { limitInputPixels: params.sharpLimitInputPixels }).rotate();
    const meta = await image.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width <= 0 || height <= 0) {
      throw new Error("Cannot read image dimensions");
    }

    const pixels = width * height;
    let scale = 1;
    if (pixels > params.maxPixels) {
      scale = Math.min(scale, Math.sqrt(params.maxPixels / pixels));
    }
    if (width > maxDimension || height > maxDimension) {
      scale = Math.min(scale, Math.min(maxDimension / width, maxDimension / height));
    }
    if (scale < 1) {
      image = image.resize({
        width: Math.max(1, Math.floor(width * scale)),
        height: Math.max(1, Math.floor(height * scale)),
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    if (output.format === "webp") {
      image = image.webp({ quality });
    } else if (output.format === "png") {
      image = image.png({ compressionLevel: 9, palette: true });
    } else {
      image = image.jpeg({ quality, mozjpeg: true });
    }

    const out = await image.toBuffer();
    const outMeta = await sharp(out).metadata().catch(() => null);
    return {
      buffer: out,
      mimeType: output.mimeType,
      width: outMeta?.width,
      height: outMeta?.height,
      bytes: out.length,
      base64Chars: estimateBase64Chars(out.length),
    };
  };

  let lastError: any = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const out = await render();
      if (out.bytes <= params.maxBytes) return out;
      if (quality > minQuality) {
        quality = Math.max(minQuality, quality - 8);
      } else {
        maxDimension = Math.max(512, Math.floor(maxDimension * 0.88));
      }
      lastError = new Error(`Still too large: ${out.bytes} bytes, ${out.base64Chars} base64 chars`);
    } catch (err) {
      lastError = err;
      maxDimension = Math.max(512, Math.floor(maxDimension * 0.88));
      quality = Math.max(minQuality, quality - 6);
    }
  }

  throw new Error(`OCR image optimization failed: ${lastError?.message || String(lastError)}`);
}
