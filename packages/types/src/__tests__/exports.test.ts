import { describe, expect, it } from "vitest";
import {
  AppError,
  AuthError,
  ExternalAPIError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from "../errors";

describe("@denim/types exports", () => {
  it("exports typed error classes", () => {
    expect(new AppError("test", 500, "TEST")).toBeInstanceOf(Error);
    expect(new ValidationError("bad input").code).toBe(400);
    expect(new AuthError().code).toBe(401);
    expect(new ForbiddenError().code).toBe(403);
    expect(new NotFoundError().code).toBe(404);
    expect(new RateLimitError().code).toBe(429);
    expect(new ExternalAPIError("api down", "claude").code).toBe(502);
  });

  it("error types have correct names", () => {
    expect(new ValidationError("test").name).toBe("ValidationError");
    expect(new AuthError().name).toBe("AuthError");
    expect(new ExternalAPIError("test").name).toBe("ExternalAPIError");
  });
});
