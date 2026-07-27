import { deleteDocument } from "../utils/vectorStore";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { fileName } = body;

  if (!fileName) {
    throw createError({
      statusCode: 400,
      statusMessage: "No file name provided",
    });
  }

  const success = await deleteDocument(fileName);
  return {
    success: success,
    message: success ? "Document deleted successfully" : "Document not found",
  };
});
