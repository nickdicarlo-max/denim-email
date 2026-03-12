/**
 * API request/response types.
 * Used by both apps/web API routes and apps/extension client code.
 */

export interface ApiResponse<T> {
  data: T;
}

export interface ApiError {
  error: string;
  code: number;
  type: string;
}
