"use client";

import { useState } from "react";
import type { EmailWithAssignment } from "./email-list";

interface ClusteringDebugProps {
	emails: EmailWithAssignment[];
}

export function ClusteringDebug({ emails }: ClusteringDebugProps) {
	const [open, setOpen] = useState(false);

	const emailsWithScores = emails.filter(
		(e) => e.clusteringScore != null || e.assignedBy,
	);

	if (emailsWithScores.length === 0) return null;

	return (
		<section className="bg-white rounded-lg shadow p-4">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex items-center gap-2 text-sm font-semibold text-secondary uppercase tracking-wide w-full"
			>
				<span className={`transition-transform ${open ? "rotate-90" : ""}`}>
					&#9654;
				</span>
				Clustering Debug
			</button>

			{open && (
				<div className="mt-3 space-y-2">
					{emailsWithScores.map((email) => (
						<div
							key={email.id}
							className="flex items-center gap-3 text-xs text-secondary border-b border-border pb-2 last:border-0"
						>
							<span className="truncate flex-1 min-w-0">{email.subject}</span>
							<span className="text-muted whitespace-nowrap">
								{email.assignedBy}
							</span>
							{email.clusteringScore != null && (
								<span className="font-mono text-muted whitespace-nowrap">
									score: {email.clusteringScore.toFixed(1)}
								</span>
							)}
							{email.clusteringConfidence != null && (
								<span className="font-mono text-muted whitespace-nowrap">
									conf: {(email.clusteringConfidence * 100).toFixed(0)}%
								</span>
							)}
						</div>
					))}
				</div>
			)}
		</section>
	);
}
