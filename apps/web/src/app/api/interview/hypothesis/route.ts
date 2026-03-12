import { withAuth } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/middleware/error-handler";
import { generateHypothesis } from "@/lib/services/interview";
import { NextResponse } from "next/server";

export const POST = withAuth(async ({ userId, request }) => {
  try {
    const body = await request.json();

    const hypothesis = await generateHypothesis(body, { userId });

    return NextResponse.json({ data: hypothesis });
  } catch (error) {
    return handleApiError(error, {
      service: "interview",
      operation: "hypothesis",
      userId,
    });
  }
});
