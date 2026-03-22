"use client";

import { formatRelativeTime } from "@/lib/utils/format-time";
import { useState } from "react";
import { Tag } from "../ui/tag";

export interface EmailWithAssignment {
	id: string;
	schemaId: string;
	subject: string;
	sender: string;
	senderDisplayName: string;
	senderDomain: string;
	date: string;
	summary: string;
	tags: string[];
	attachmentCount: number;
	isExcluded: boolean;
	assignedBy: string;
	clusteringScore: number | null;
}

interface EmailListProps {
	emails: EmailWithAssignment[];
	schemaId: string;
}

export function EmailList({ emails, schemaId }: EmailListProps) {
	return (
		<section className="bg-white rounded-lg shadow p-4 space-y-3">
			<h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">
				Emails ({emails.length})
			</h2>

			<div className="space-y-2">
				{emails.map((email) => (
					<EmailItem
						key={email.id}
						email={email}
						schemaId={schemaId}
					/>
				))}
			</div>
		</section>
	);
}

function EmailItem({
	email,
	schemaId,
}: {
	email: EmailWithAssignment;
	schemaId: string;
}) {
	const [excluded, setExcluded] = useState(email.isExcluded);
	const [excluding, setExcluding] = useState(false);

	async function handleExclude() {
		setExcluding(true);
		try {
			const { createBrowserClient } = await import("@/lib/supabase/client");
			const supabase = createBrowserClient();
			const {
				data: { session },
			} = await supabase.auth.getSession();

			const res = await fetch("/api/feedback", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${session?.access_token ?? ""}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					schemaId,
					type: "EMAIL_EXCLUDE",
					emailId: email.id,
					payload: {
						senderDomain: email.senderDomain,
						senderEmail: email.sender,
					},
				}),
			});

			if (res.ok) {
				setExcluded(true);
			}
		} finally {
			setExcluding(false);
		}
	}

	return (
		<div
			className={`border border-border rounded-lg p-3 space-y-1.5 ${
				excluded ? "opacity-50" : ""
			}`}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<h4 className="text-sm font-medium text-primary truncate">
							{email.subject}
						</h4>
						{email.attachmentCount > 0 && (
							<span className="text-xs text-muted flex-shrink-0">
								\uD83D\uDCCE {email.attachmentCount}
							</span>
						)}
					</div>
					<div className="flex items-center gap-2 text-xs text-secondary mt-0.5">
						<span className="truncate">{email.senderDisplayName}</span>
						<span className="text-muted">
							{formatRelativeTime(new Date(email.date))}
						</span>
					</div>
				</div>

				{!excluded && (
					<button
						type="button"
						onClick={handleExclude}
						disabled={excluding}
						className="text-xs text-muted hover:text-error transition px-2 py-1 rounded hover:bg-red-50 whitespace-nowrap"
					>
						{excluding ? "..." : "Exclude"}
					</button>
				)}
			</div>

			{email.summary && (
				<p className="text-xs text-secondary leading-relaxed">{email.summary}</p>
			)}

			<div className="flex items-center gap-1.5 flex-wrap">
				{email.tags.slice(0, 3).map((tag) => (
					<Tag key={tag} label={tag} size="sm" />
				))}

				</div>
		</div>
	);
}
