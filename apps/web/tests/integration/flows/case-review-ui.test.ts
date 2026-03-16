/**
 * Case Review UI Integration Test
 *
 * Seeds data through the full pipeline (emails -> clustering -> synthesis),
 * then tests the case review API routes (GET /api/cases, GET /api/cases/[id],
 * GET /api/schemas/[schemaId]/summary) and feedback from the UI.
 *
 * Prerequisites:
 *   - .env.local with DATABASE_URL, SUPABASE keys, ANTHROPIC_API_KEY
 *   - Dev server running (`pnpm --filter web dev`)
 *
 * Run: pnpm --filter web test:integration -- --testPathPattern=case-review-ui
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

describe("Case Review UI (HTTP)", () => {
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
			"clusterNewEmails (case-review setup)",
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
				`synthesizeCase (case-review setup, caseId=${c.id})`,
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
	// GET /api/cases — paginated case list
	// -------------------------------------------------------------------
	it("returns paginated case list for schema", async () => {
		const res = await withTimeout(
			api.get(`/api/cases?schemaId=${testSchema.schema.id}`),
			30_000,
			"GET /api/cases",
		);

		expect(res.status).toBe(200);

		const body = res.data as {
			data: {
				cases: Array<{
					id: string;
					title: string;
					status: string;
					emailCount: number;
					entityName: string;
					displayTags: string[];
					actions: Array<{ id: string; title: string }>;
				}>;
				nextCursor: string | null;
			};
		};

		expect(body.data.cases.length).toBe(3);

		for (const c of body.data.cases) {
			expect(c.id).toBeTruthy();
			expect(c.title).toBeTruthy();
			expect(c.status).toMatch(/^(OPEN|IN_PROGRESS|RESOLVED)$/);
			expect(c.emailCount).toBeGreaterThanOrEqual(1);
			expect(c.entityName).toBeTruthy();
			expect(Array.isArray(c.displayTags)).toBe(true);
		}
	});

	// -------------------------------------------------------------------
	// GET /api/cases — filter by status
	// -------------------------------------------------------------------
	it("filters cases by status", async () => {
		const res = await withTimeout(
			api.get(
				`/api/cases?schemaId=${testSchema.schema.id}&status=OPEN`,
			),
			30_000,
			"GET /api/cases?status=OPEN",
		);

		expect(res.status).toBe(200);

		const body = res.data as {
			data: { cases: Array<{ status: string }> };
		};

		for (const c of body.data.cases) {
			expect(c.status).toBe("OPEN");
		}
	});

	// -------------------------------------------------------------------
	// GET /api/cases — filter by entity
	// -------------------------------------------------------------------
	it("filters cases by entityId", async () => {
		const res = await withTimeout(
			api.get(
				`/api/cases?schemaId=${testSchema.schema.id}&entityId=${testSchema.entities.vms.id}`,
			),
			30_000,
			"GET /api/cases?entityId=vms",
		);

		expect(res.status).toBe(200);

		const body = res.data as {
			data: { cases: Array<{ entityId: string }> };
		};

		// VMS should have 2 cases
		expect(body.data.cases.length).toBe(2);
		for (const c of body.data.cases) {
			expect(c.entityId).toBe(testSchema.entities.vms.id);
		}
	});

	// -------------------------------------------------------------------
	// GET /api/cases — rejects invalid limit
	// -------------------------------------------------------------------
	it("rejects invalid limit with 400", async () => {
		const res = await withTimeout(
			api.get(
				`/api/cases?schemaId=${testSchema.schema.id}&limit=999`,
			),
			30_000,
			"GET /api/cases (bad limit)",
		);

		expect(res.status).toBe(400);
	});

	// -------------------------------------------------------------------
	// GET /api/cases — rejects missing schemaId
	// -------------------------------------------------------------------
	it("rejects missing schemaId with 400", async () => {
		const res = await withTimeout(
			api.get("/api/cases"),
			30_000,
			"GET /api/cases (no schemaId)",
		);

		expect(res.status).toBe(400);
	});

	// -------------------------------------------------------------------
	// GET /api/cases — auth required
	// -------------------------------------------------------------------
	it("rejects unauthenticated case list request", async () => {
		const unauthApi = createApiClient("invalid-token");
		const res = await withTimeout(
			unauthApi.get(`/api/cases?schemaId=${testSchema.schema.id}`),
			30_000,
			"GET /api/cases (unauth)",
		);

		expect(res.status).toBe(401);
	});

	// -------------------------------------------------------------------
	// GET /api/cases/[id] — single case detail
	// -------------------------------------------------------------------
	it("returns full case detail with emails and actions", async () => {
		const caseId = caseIds[0];
		const res = await withTimeout(
			api.get(`/api/cases/${caseId}`),
			30_000,
			"GET /api/cases/[id]",
		);

		expect(res.status).toBe(200);

		const body = res.data as {
			data: {
				case: {
					id: string;
					title: string;
					summary: { beginning: string; middle: string; end: string };
					status: string;
					viewedAt: string;
					actions: Array<{
						id: string;
						title: string;
						actionType: string;
						status: string;
					}>;
				};
				emails: Array<{
					id: string;
					subject: string;
					senderDisplayName: string;
					assignedBy: string;
				}>;
				summaryLabels: { beginning: string; middle: string; end: string };
				extractedFieldDefs: Array<{ name: string }>;
			};
		};

		const c = body.data.case;
		expect(c.id).toBe(caseId);
		expect(c.title).toBeTruthy();
		expect(c.summary.beginning).toBeTruthy();
		expect(c.summary.middle).toBeTruthy();
		expect(c.summary.end).toBeTruthy();
		expect(c.viewedAt).toBeTruthy(); // Should be set by the endpoint

		// Emails should be present
		expect(body.data.emails.length).toBeGreaterThanOrEqual(1);
		for (const email of body.data.emails) {
			expect(email.subject).toBeTruthy();
			expect(email.assignedBy).toBeTruthy();
		}

		// Summary labels from schema
		expect(body.data.summaryLabels).toBeDefined();
	});

	// -------------------------------------------------------------------
	// GET /api/cases/[id] — sets viewedAt
	// -------------------------------------------------------------------
	it("updates viewedAt on case detail view", async () => {
		const caseId = caseIds[0];

		// Clear viewedAt
		await prisma.case.update({
			where: { id: caseId },
			data: { viewedAt: null },
		});

		// View the case
		await withTimeout(
			api.get(`/api/cases/${caseId}`),
			30_000,
			"GET /api/cases/[id] (viewedAt)",
		);

		// Verify viewedAt is now set
		const updated = await prisma.case.findUniqueOrThrow({
			where: { id: caseId },
		});
		expect(updated.viewedAt).toBeTruthy();
	});

	// -------------------------------------------------------------------
	// GET /api/cases/[id] — 404 for nonexistent case
	// -------------------------------------------------------------------
	it("returns 404 for nonexistent case", async () => {
		const res = await withTimeout(
			api.get("/api/cases/nonexistent-id"),
			30_000,
			"GET /api/cases/nonexistent",
		);

		expect(res.status).toBe(404);
	});

	// -------------------------------------------------------------------
	// GET /api/schemas/[schemaId]/summary — feed header data
	// -------------------------------------------------------------------
	it("returns schema summary with status counts", async () => {
		const res = await withTimeout(
			api.get(`/api/schemas/${testSchema.schema.id}/summary`),
			30_000,
			"GET /api/schemas/[schemaId]/summary",
		);

		expect(res.status).toBe(200);

		const body = res.data as {
			data: {
				name: string;
				domain: string;
				entities: Array<{ id: string; name: string }>;
				statusCounts: Record<string, number>;
				qualityPhase: string;
			};
		};

		expect(body.data.name).toBeTruthy();
		expect(body.data.entities.length).toBeGreaterThanOrEqual(1);
		expect(body.data.statusCounts).toBeDefined();

		// Total from status counts should equal number of cases
		const total = Object.values(body.data.statusCounts).reduce(
			(a, b) => a + b,
			0,
		);
		expect(total).toBe(3);

		expect(body.data.qualityPhase).toBe("CALIBRATING");
	});

	// -------------------------------------------------------------------
	// Thumbs up via feedback endpoint (UI flow)
	// -------------------------------------------------------------------
	it("thumbs up from case detail creates FeedbackEvent", async () => {
		const caseId = caseIds[0];
		const res = await withTimeout(
			api.post("/api/feedback", {
				schemaId: testSchema.schema.id,
				type: "THUMBS_UP",
				caseId,
			}),
			30_000,
			"POST /api/feedback (THUMBS_UP from case detail)",
		);

		expect(res.status).toBe(200);

		const body = res.data as { data: { eventId: string } };
		expect(body.data.eventId).toBeTruthy();

		const event = await prisma.feedbackEvent.findUnique({
			where: { id: body.data.eventId },
		});
		expect(event).toBeDefined();
		expect(event!.eventType).toBe("THUMBS_UP");
		expect(event!.caseId).toBe(caseId);
	});

	// -------------------------------------------------------------------
	// Thumbs down with reason via feedback endpoint (UI flow)
	// -------------------------------------------------------------------
	it("thumbs down with reason creates FeedbackEvent", async () => {
		const caseId = caseIds[1];
		const res = await withTimeout(
			api.post("/api/feedback", {
				schemaId: testSchema.schema.id,
				type: "THUMBS_DOWN",
				caseId,
				payload: { reason: "wrong_group" },
			}),
			30_000,
			"POST /api/feedback (THUMBS_DOWN from case detail)",
		);

		expect(res.status).toBe(200);

		const body = res.data as { data: { eventId: string } };
		const event = await prisma.feedbackEvent.findUnique({
			where: { id: body.data.eventId },
		});
		expect(event!.eventType).toBe("THUMBS_DOWN");
		expect((event!.payload as Record<string, unknown>).reason).toBe(
			"wrong_group",
		);
	});

	// -------------------------------------------------------------------
	// Email exclude from case detail creates FeedbackEvent
	// -------------------------------------------------------------------
	it("email exclude from case detail marks email excluded", async () => {
		// Find a non-excluded email in the first case
		const caseEmail = await prisma.caseEmail.findFirst({
			where: { caseId: caseIds[0] },
			include: { email: true },
		});
		expect(caseEmail).toBeDefined();

		const res = await withTimeout(
			api.post("/api/feedback", {
				schemaId: testSchema.schema.id,
				type: "EMAIL_EXCLUDE",
				emailId: caseEmail!.email.id,
				payload: {
					senderDomain: caseEmail!.email.senderDomain,
					senderEmail: caseEmail!.email.senderEmail,
				},
			}),
			30_000,
			"POST /api/feedback (EMAIL_EXCLUDE from case detail)",
		);

		expect(res.status).toBe(200);

		const updated = await prisma.email.findUniqueOrThrow({
			where: { id: caseEmail!.email.id },
		});
		expect(updated.isExcluded).toBe(true);
	});

	// -------------------------------------------------------------------
	// Cursor pagination works
	// -------------------------------------------------------------------
	it("cursor pagination returns different results", async () => {
		// Get first page with limit=1
		const page1 = await withTimeout(
			api.get(
				`/api/cases?schemaId=${testSchema.schema.id}&limit=1`,
			),
			30_000,
			"GET /api/cases (page 1)",
		);

		expect(page1.status).toBe(200);

		const body1 = page1.data as {
			data: {
				cases: Array<{ id: string }>;
				nextCursor: string | null;
			};
		};

		expect(body1.data.cases.length).toBe(1);
		expect(body1.data.nextCursor).toBeTruthy();

		// Get second page
		const page2 = await withTimeout(
			api.get(
				`/api/cases?schemaId=${testSchema.schema.id}&limit=1&cursor=${body1.data.nextCursor}`,
			),
			30_000,
			"GET /api/cases (page 2)",
		);

		expect(page2.status).toBe(200);

		const body2 = page2.data as {
			data: {
				cases: Array<{ id: string }>;
				nextCursor: string | null;
			};
		};

		expect(body2.data.cases.length).toBe(1);
		// Different case than page 1
		expect(body2.data.cases[0].id).not.toBe(body1.data.cases[0].id);
	});
});
