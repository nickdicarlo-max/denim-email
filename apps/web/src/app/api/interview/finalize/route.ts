import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { finalizeSchema } from "@/lib/services/interview";
import { NextResponse } from "next/server";

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const body = await request.json();
    const { hypothesis, validation, confirmations } = body;

    if (!hypothesis || !validation || !confirmations) {
      return NextResponse.json(
        {
          error: "Missing required fields: hypothesis, validation, confirmations",
        },
        { status: 400 },
      );
    }

    const schemaId = await finalizeSchema(hypothesis, validation, confirmations, { userId });

    return NextResponse.json({ data: { schemaId } });
  } catch (error) {
    return handleApiError(error, {
      service: "interview",
      operation: "finalize",
      userId,
    });
  }
});
