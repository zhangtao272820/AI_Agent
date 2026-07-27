import { getOidcPublicConfig } from "../../utils/oidc_identity";

export default defineEventHandler(() => {
  return { ok: true, oidc: getOidcPublicConfig() };
});
