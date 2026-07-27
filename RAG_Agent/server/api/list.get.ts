import { getUploadedDocuments } from "../utils/vectorStore";

export default defineEventHandler(async (event) => {
  const documents = await getUploadedDocuments();
  return {
    documents: documents,
  };
});
