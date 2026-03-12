export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly type: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}

export class AuthError extends AppError {
  constructor(message = "Not authenticated") {
    super(message, 401, "AUTH_ERROR");
    this.name = "AuthError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, 403, "FORBIDDEN_ERROR");
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, 404, "NOT_FOUND_ERROR");
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many requests") {
    super(message, 429, "RATE_LIMIT_ERROR");
    this.name = "RateLimitError";
  }
}

export class ExternalAPIError extends AppError {
  constructor(
    message: string,
    public readonly service?: string,
    public readonly rawResponse?: unknown,
  ) {
    super(message, 502, "EXTERNAL_API_ERROR");
    this.name = "ExternalAPIError";
  }
}
