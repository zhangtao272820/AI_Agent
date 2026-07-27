import { clearSchemaCache } from "../../../utils/schema";
import { invalidateDomainPatchCache } from "../../../utils/domain_patch";

export default defineEventHandler(() => {
  clearSchemaCache();
  invalidateDomainPatchCache();
  return { ok: true, message: "schema cache and domain patch cache cleared" };
});
