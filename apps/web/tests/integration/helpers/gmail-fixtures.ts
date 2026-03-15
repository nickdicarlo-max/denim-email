/**
 * Gmail fixture factory — builds GmailMessageFull objects from minimal input
 * for extraction integration tests.
 */
import type { GmailMessageFull } from "@/lib/gmail/types";

interface GmailFixtureInput {
	id: string;
	threadId: string;
	subject: string;
	senderEmail: string;
	senderDisplayName: string;
	body: string;
	date?: Date;
	isReply?: boolean;
	attachmentCount?: number;
	recipients?: string[];
}

/**
 * Build a GmailMessageFull fixture from minimal input.
 * Derives senderDomain, sender string, and defaults from the input.
 */
export function buildGmailFixture(input: GmailFixtureInput): GmailMessageFull {
	const domain = input.senderEmail.split("@")[1];
	return {
		id: input.id,
		threadId: input.threadId,
		subject: input.subject,
		sender: `${input.senderDisplayName} <${input.senderEmail}>`,
		senderEmail: input.senderEmail,
		senderDomain: domain,
		senderDisplayName: input.senderDisplayName,
		recipients: input.recipients ?? [],
		date: input.date ?? new Date(),
		snippet: input.body.slice(0, 100),
		isReply: input.isReply ?? false,
		labels: [],
		body: input.body,
		attachmentIds: [],
		attachmentCount: input.attachmentCount ?? 0,
	};
}
