/**
 * Feedback Flow Integration Test
 *
 * Seeds data through the full pipeline (emails -> clustering -> synthesis),
 * then tests feedback via HTTP routes and service calls.
 *
 * Prerequisites:
 *   - .env.local with DATABASE_URL, SUPABASE keys, ANTHROPIC_API_KEY
 *   - Dev server running (`pnpm --filter web dev`)
 *
 * Run: pnpm --filter web test:integration -- --testPathPattern=feedback
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
	createTestUser,
	cleanupTestUser,
	type TestUser,
} from "../helpers/test-user";
import {
	createTestSchema,
	type TestSchemaResult,
} from "../helpers/test-schema";
import { seedTestEmails } from "../helpers/test-emails";
import { createApiClient } from "../helpers/api-client";
import { withTimeout } from "../helpers/timeout";
import { clusterNewEmails } from "@/lib/services/cluster";
import { synthesizeCase } from "@/lib/services/synthesis";
import { prisma } from "@/lib/prisma";

let testUser: TestUser;
let testSchema: TestSchemaResult;
let api: ReturnType<typeof createApiClient>;
let caseIds: string[] = [];

describe("Feedback Flow (HTTP)", () => {
	beforeAll(async () => {
		testUser = await withTimeout(
			createTestUser(),
			30_000,
			"createTestUser",
		);
		testSchema = await createTestSchema(testUser.userId);
		api = createApiClient(testUser.accessToken);

		await seedTestEmails(testSchema.schema.id, {
			vmsId: testSchema.entities.vms.id,
			evscId: testSchema.entities.evsc.id,
			coachId: testSchema.entities.coach.id,
		});

		// Cluster to create cases
		await withTimeout(
			clusterNewEmails(testSchema.schema.id),
			60_000,
			"clusterNewEmails (feedback setup)",
		);

		// Synthesize all cases
		const cases = await prisma.case.findMany({
			where: { schemaId: testSchema.schema.id },
		});
		caseIds = cases.map((c) => c.id);

		for (const c of cases) {
			await withTimeout(
				synthesizeCase(c.id, testSchema.schema.id),
				300_000,
				`synthesizeCase (feedback setup, caseId=${c.id})`,
			);
		}
	}, 600_000);

	afterAll(async () => {
		if (testUser?.userId) {
			await cleanupTestUser(testUser.userId);
		}
		await prisma.$disconnect();
	}, 30_000);

	// -------------------------------------------------------------------
	// Auth
	// -------------------------------------------------------------------
	it("rejects unauthenticated feedback request with 401", async () => {
		const unauthApi = createApiClient("invalid-token");
		const res = await withTimeout(
			unauthApi.post("/api/feedback", {
				schemaId: testSchema.schema.id,
				type: "THUMBS_UP",
				caseId: caseIds[0],
			}),
			15_000,
			"POST /api/feedback (unauth)",
		);
		expect(res.status).toBe(401);
	});

	// -------------------------------------------------------------------
	// Zod Validation
	// -------------------------------------------------------------------
	it("rejects invalid feedback type with 400", async () => {
		const res = await withTimeout(
			api.post("/api/feedback", {
				schemaId: testSchema.schema.id,
				type: "INVALID_TYPE",
				caseId: caseIds[0],
			}),
			15_000,
			"POST /api/feedback (invalid type)",
		);
		expect(res.status).toBe(400);
	});

	// -------------------------------------------------------------------
	// THUMBS_DOWN creates FeedbackEvent
	// -------------------------------------------------------------------
	it("thumbs down creates FeedbackEvent", async () => {
		const res = await withTimeout(
			api.post("/api/feedback", {
				schemaId: testSchema.schema.id,
				type: "THUMBS_DOWN",
				caseId: caseIds[0],
				payload: { reason: "Wrong emails grouped together" },
			}),
			15_000,
			"POST /api/feedback (THUMBS_DOWN)",
		);

		expect(res.status).toBe(200);

		const body = res.data as { data: { eventId: string } };
		expect(body.data.eventId).toBeTruthy();

		// Verify in DB
		const event = await prisma.feedbackEvent.findUnique({
			where: { id: body.data.eventId },
		});
		expect(event).toBeDefined();
		expect(event!.eventType).toBe("THUMBS_DOWN");
		expect(event!.caseId).toBe(caseIds[0]);
		expect(event!.schemaId).toBe(testSchema.schema.id);
	});

	// -------------------------------------------------------------------
	// EMAIL_EXCLUDE sets isExcluded on email
	// -------------------------------------------------------------------
	it("email exclude marks email as excluded", async () => {
		// Find a non-excluded email
		const email = await prisma.email.findFirst({
			where: {
				schemaId: testSchema.schema.id,
				isExcluded: false,
			},
		});
		expect(email).toBeDefined();

		const res = await withTimeout(
			api.post("/api/feedback", {
				schemaId: testSchema.schema.id,
				type: "EMAIL_EXCLUDE",
				emailId: email!.id,
				payload: { reason: "Not relevant" },
			}),
			15_000,
			"POST /api/feedback (EMAIL_EXCLUDE)",
		);

		expect(res.status).toBe(200);

		// Verify email is now excluded
		const updated = await prisma.email.findUniqueOrThrow({
			where: { id: email!.id },
		});
		expect(updated.isExcluded).toBe(true);
		expect(updated.excludeReason).toBe("user:manual");
	});

	// -------------------------------------------------------------------
	// THUMBS_UP works
	// -------------------------------------------------------------------
	it("thumbs up creates FeedbackEvent", async () => {
		const res = await withTimeout(
			api.post("/api/feedback", {
				schemaId: testSchema.schema.id,
				type: "THUMBS_UP",
				caseId: caseIds[0],
			}),
			15_000,
			"POST /api/feedback (THUMBS_UP)",
		);

		expect(res.status).toBe(200);

		const body = res.data as { data: { eventId: string } };
		expect(body.data.eventId).toBeTruthy();
	});

	// -------------------------------------------------------------------
	// RLS: another user can't feedback on this schema
	// -------------------------------------------------------------------
	it("another user gets NotFoundError when targeting this schema", async () => {
		// Create a second user directly in Prisma (no Supabase auth needed)
		const otherUser = await prisma.user.create({
			data: {
				id: `other-user-${Date.now()}`,
				email: "other@test.com",
				displayName: "Other User",
			},
		});

		// Test the service directly — calling via HTTP would require a second auth token
		const { recordFeedback } = await import("@/lib/services/feedback");

		let threw = false;
		try {
			await recordFeedback(
				{
					schemaId: testSchema.schema.id,
					type: "THUMBS_UP",
					caseId: caseIds[0],
				},
				otherUser.id,
			);
		} catch (error: unknown) {
			threw = true;
			expect((error as Error).constructor.name).toBe("NotFoundError");
		}

		expect(threw).toBe(true);

		// Clean up other user
		await prisma.user.delete({ where: { id: otherUser.id } });
	});

	// -------------------------------------------------------------------
	// FeedbackEvents are append-only
	// -------------------------------------------------------------------
	it("multiple feedback events accumulate (append-only)", async () => {
		const events = await prisma.feedbackEvent.findMany({
			where: { schemaId: testSchema.schema.id },
			orderBy: { createdAt: "asc" },
		});

		// We created THUMBS_DOWN, EMAIL_EXCLUDE, and THUMBS_UP above
		expect(events.length).toBeGreaterThanOrEqual(3);

		// All events should have distinct IDs and timestamps
		const ids = events.map((e) => e.id);
		const uniqueIds = new Set(ids);
		expect(uniqueIds.size).toBe(ids.length);
	});
});
