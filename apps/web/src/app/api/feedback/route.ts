import { ValidationError } from "@denim/types";
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { recordFeedback } from "@/lib/services/feedback";
import { FeedbackInputSchema } from "@/lib/validation/feedback";

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const body = await request.json();

    const parsed = FeedbackInputSchema.safeParse(body);
    if (!parsed.success) {
      const messages = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new ValidationError(messages);
    }

    const result = await recordFeedback(parsed.data, userId);

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error, {
      service: "feedback",
      operation: "POST /api/feedback",
      userId,
    });
  }
});
