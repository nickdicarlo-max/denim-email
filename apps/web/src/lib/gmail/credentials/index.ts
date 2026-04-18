/**
 * Public entry point for the Gmail credentials bounded context.
 *
 * Callers should import from `@/lib/gmail/credentials` — never from the
 * individual files. The sub-modules (`storage`, `parsers`, `dev-bypass`)
 * are implementation details.
 */

export {
  type GoogleTokenErrorResponse,
  GoogleTokenErrorResponseSchema,
  type GoogleTokenInfoResponse,
  GoogleTokenInfoResponseSchema,
  type GoogleTokenRefreshResponse,
  GoogleTokenRefreshResponseSchema,
  type SupabaseExchangeData,
  SupabaseExchangeDataSchema,
} from "./parsers";
export {
  getAccessToken,
  getCredentialRecord,
  invalidateCredentials,
  type StoreCredentialsInput,
  StoreCredentialsInputSchema,
  storeCredentials,
} from "./service";
