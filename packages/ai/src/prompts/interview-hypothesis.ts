/**
 * Hypothesis prompt builder for interview-driven schema generation.
 * Pure function — no I/O, no side effects.
 */
import type { InterviewInput } from "@denim/types";

export interface HypothesisPromptResult {
  system: string;
  user: string;
}

interface DomainConfig {
  mergeThreshold: number;
  timeDecayFresh: number;
  reminderCollapseEnabled: boolean;
  caseSizeThreshold: number;
  tags: {
    name: string;
    description: string;
    frequency: "high" | "medium" | "low";
    actionable: boolean;
  }[];
  fields: {
    name: string;
    type: "NUMBER" | "STRING" | "DATE" | "BOOLEAN";
    showOnCard: boolean;
    aggregation: "SUM" | "LATEST" | "MAX" | "MIN" | "COUNT" | "FIRST";
  }[];
  summaryLabels: { beginning: string; middle: string; end: string };
  secondaryEntityTypes: string[];
  exclusionHints: string[];
}

const DOMAIN_CONFIGS: Record<string, DomainConfig> = {
  school_parent: {
    mergeThreshold: 35,
    timeDecayFresh: 60,
    reminderCollapseEnabled: true,
    caseSizeThreshold: 5,
    tags: [
      {
        name: "Action Required",
        description: "Requires parent action or response",
        frequency: "high",
        actionable: true,
      },
      {
        name: "Schedule",
        description: "Schedule changes, dates, or calendar events",
        frequency: "high",
        actionable: false,
      },
      {
        name: "Payment",
        description: "Fees, dues, fundraising, or financial requests",
        frequency: "medium",
        actionable: true,
      },
      {
        name: "Permission/Form",
        description: "Forms or permission slips needing signature",
        frequency: "medium",
        actionable: true,
      },
      {
        name: "Game/Match",
        description: "Game schedules, scores, or match information",
        frequency: "medium",
        actionable: false,
      },
      {
        name: "Practice",
        description: "Practice schedules, locations, or cancellations",
        frequency: "high",
        actionable: false,
      },
      {
        name: "Cancellation",
        description: "Cancelled events, practices, or meetings",
        frequency: "low",
        actionable: false,
      },
      {
        name: "Volunteer",
        description: "Volunteer opportunities or sign-up requests",
        frequency: "low",
        actionable: true,
      },
    ],
    fields: [
      { name: "eventDate", type: "DATE", showOnCard: true, aggregation: "LATEST" },
      { name: "eventLocation", type: "STRING", showOnCard: false, aggregation: "LATEST" },
      { name: "amount", type: "NUMBER", showOnCard: false, aggregation: "SUM" },
    ],
    summaryLabels: { beginning: "What", middle: "Details", end: "Action Needed" },
    secondaryEntityTypes: ["Coach", "Teacher", "Administrator", "Parent", "Organization"],
    exclusionHints: ["noreply@", "newsletter@", "marketing@", "promotions@"],
  },
  property: {
    mergeThreshold: 45,
    timeDecayFresh: 45,
    reminderCollapseEnabled: false,
    caseSizeThreshold: 10,
    tags: [
      {
        name: "Maintenance",
        description: "Repair requests, maintenance issues, or work orders",
        frequency: "high",
        actionable: true,
      },
      {
        name: "Tenant",
        description: "Tenant communications, lease questions, or complaints",
        frequency: "high",
        actionable: true,
      },
      {
        name: "Vendor",
        description: "Vendor bids, invoices, or coordination",
        frequency: "medium",
        actionable: true,
      },
      {
        name: "Financial",
        description: "Rent payments, expenses, or financial reports",
        frequency: "high",
        actionable: false,
      },
      {
        name: "Lease",
        description: "Lease agreements, renewals, or terminations",
        frequency: "medium",
        actionable: true,
      },
      {
        name: "Inspection",
        description: "Property inspections, reports, or findings",
        frequency: "low",
        actionable: true,
      },
      {
        name: "Compliance",
        description: "Regulatory compliance, permits, or violations",
        frequency: "low",
        actionable: true,
      },
      {
        name: "Emergency",
        description: "Urgent issues requiring immediate attention",
        frequency: "low",
        actionable: true,
      },
    ],
    fields: [
      { name: "cost", type: "NUMBER", showOnCard: true, aggregation: "SUM" },
      { name: "deadline", type: "DATE", showOnCard: false, aggregation: "LATEST" },
    ],
    summaryLabels: { beginning: "Issue", middle: "Activity", end: "Status" },
    secondaryEntityTypes: ["Tenant", "Vendor", "Inspector", "Contractor", "Agent"],
    exclusionHints: ["noreply@", "newsletter@", "marketing@", "alerts@"],
  },
  construction: {
    mergeThreshold: 45,
    timeDecayFresh: 45,
    reminderCollapseEnabled: false,
    caseSizeThreshold: 10,
    tags: [
      {
        name: "RFI",
        description: "Requests for information requiring response",
        frequency: "high",
        actionable: true,
      },
      {
        name: "Change Order",
        description: "Scope changes, cost adjustments, or contract modifications",
        frequency: "medium",
        actionable: true,
      },
      {
        name: "Submittal",
        description: "Material submittals, shop drawings, or approvals",
        frequency: "high",
        actionable: true,
      },
      {
        name: "Schedule",
        description: "Project timeline updates, milestones, or delays",
        frequency: "high",
        actionable: false,
      },
      {
        name: "Permits",
        description: "Building permits, inspections, or regulatory approvals",
        frequency: "low",
        actionable: true,
      },
      {
        name: "Safety",
        description: "Safety incidents, reports, or compliance issues",
        frequency: "low",
        actionable: true,
      },
      {
        name: "Invoice/Payment",
        description: "Payment applications, invoices, or financial matters",
        frequency: "medium",
        actionable: true,
      },
      {
        name: "Punch List",
        description: "Deficiency items, corrections, or completion tasks",
        frequency: "medium",
        actionable: true,
      },
    ],
    fields: [
      { name: "cost", type: "NUMBER", showOnCard: true, aggregation: "SUM" },
      { name: "deadline", type: "DATE", showOnCard: true, aggregation: "LATEST" },
      { name: "percentComplete", type: "NUMBER", showOnCard: false, aggregation: "LATEST" },
    ],
    summaryLabels: { beginning: "Issue", middle: "Progress", end: "Current Status" },
    secondaryEntityTypes: [
      "Subcontractor",
      "Architect",
      "Engineer",
      "Inspector",
      "Owner Representative",
    ],
    exclusionHints: ["noreply@", "newsletter@", "marketing@", "system@"],
  },
  legal: {
    mergeThreshold: 55,
    timeDecayFresh: 90,
    reminderCollapseEnabled: false,
    caseSizeThreshold: 15,
    tags: [
      {
        name: "Filing",
        description: "Court filings, documents, or submissions",
        frequency: "medium",
        actionable: true,
      },
      {
        name: "Discovery",
        description: "Discovery requests, responses, or depositions",
        frequency: "medium",
        actionable: true,
      },
      {
        name: "Motion",
        description: "Motions, briefs, or legal arguments",
        frequency: "medium",
        actionable: true,
      },
      {
        name: "Hearing",
        description: "Court hearings, conferences, or appearances",
        frequency: "low",
        actionable: true,
      },
      {
        name: "Settlement",
        description: "Settlement discussions, offers, or negotiations",
        frequency: "low",
        actionable: true,
      },
      {
        name: "Billing",
        description: "Legal fees, invoices, or billing inquiries",
        frequency: "medium",
        actionable: false,
      },
      {
        name: "Correspondence",
        description: "Letters, notices, or formal communications",
        frequency: "high",
        actionable: false,
      },
      {
        name: "Deadline",
        description: "Statutory deadlines, filing dates, or time-sensitive matters",
        frequency: "high",
        actionable: true,
      },
    ],
    fields: [
      { name: "deadline", type: "DATE", showOnCard: true, aggregation: "LATEST" },
      { name: "filingDate", type: "DATE", showOnCard: false, aggregation: "LATEST" },
    ],
    summaryLabels: { beginning: "Matter", middle: "Proceedings", end: "Status" },
    secondaryEntityTypes: ["Attorney", "Paralegal", "Judge", "Opposing Counsel", "Client"],
    exclusionHints: ["noreply@", "newsletter@", "marketing@", "ecf@"],
  },
  agency: {
    mergeThreshold: 45,
    timeDecayFresh: 45,
    reminderCollapseEnabled: false,
    caseSizeThreshold: 8,
    tags: [
      {
        name: "Deliverable",
        description: "Work products, assets, or deliverable submissions",
        frequency: "high",
        actionable: true,
      },
      {
        name: "Feedback",
        description: "Client feedback, revisions, or approval requests",
        frequency: "high",
        actionable: true,
      },
      {
        name: "Meeting",
        description: "Meeting invites, agendas, or follow-ups",
        frequency: "medium",
        actionable: false,
      },
      {
        name: "Timeline",
        description: "Project timeline updates or deadline changes",
        frequency: "medium",
        actionable: false,
      },
      {
        name: "Budget",
        description: "Budget discussions, overages, or financial updates",
        frequency: "low",
        actionable: true,
      },
      {
        name: "Approval",
        description: "Approval requests for creative, budget, or strategy",
        frequency: "medium",
        actionable: true,
      },
      {
        name: "Creative",
        description: "Creative briefs, concepts, or design discussions",
        frequency: "high",
        actionable: false,
      },
      {
        name: "Strategy",
        description: "Strategic planning, campaign strategy, or positioning",
        frequency: "low",
        actionable: false,
      },
    ],
    fields: [
      { name: "deadline", type: "DATE", showOnCard: true, aggregation: "LATEST" },
      { name: "budget", type: "NUMBER", showOnCard: false, aggregation: "SUM" },
    ],
    summaryLabels: { beginning: "Brief", middle: "Progress", end: "Status" },
    secondaryEntityTypes: [
      "Client Contact",
      "Account Manager",
      "Creative Director",
      "Strategist",
      "Vendor",
    ],
    exclusionHints: ["noreply@", "newsletter@", "marketing@", "notifications@"],
  },
  general: {
    mergeThreshold: 45,
    timeDecayFresh: 45,
    reminderCollapseEnabled: false,
    caseSizeThreshold: 8,
    tags: [
      {
        name: "Action Required",
        description: "Requires a response or action",
        frequency: "high",
        actionable: true,
      },
      {
        name: "Update",
        description: "Status updates or progress reports",
        frequency: "high",
        actionable: false,
      },
      {
        name: "Request",
        description: "Requests for information, approval, or resources",
        frequency: "medium",
        actionable: true,
      },
      {
        name: "Meeting",
        description: "Meeting invites, agendas, or follow-ups",
        frequency: "medium",
        actionable: false,
      },
      {
        name: "Financial",
        description: "Invoices, payments, or financial matters",
        frequency: "medium",
        actionable: true,
      },
      {
        name: "Deadline",
        description: "Time-sensitive items with specific due dates",
        frequency: "medium",
        actionable: true,
      },
      {
        name: "Reference",
        description: "Reference material, documentation, or archives",
        frequency: "low",
        actionable: false,
      },
      {
        name: "Approval",
        description: "Items needing sign-off or authorization",
        frequency: "low",
        actionable: true,
      },
    ],
    fields: [
      { name: "deadline", type: "DATE", showOnCard: true, aggregation: "LATEST" },
      { name: "amount", type: "NUMBER", showOnCard: false, aggregation: "SUM" },
    ],
    summaryLabels: { beginning: "Topic", middle: "Details", end: "Status" },
    secondaryEntityTypes: ["Contact", "Organization", "Vendor", "Manager", "Team Member"],
    exclusionHints: ["noreply@", "newsletter@", "marketing@", "notifications@"],
  },
};

function getDomainConfig(domain: string): DomainConfig {
  return DOMAIN_CONFIGS[domain] ?? DOMAIN_CONFIGS.general;
}

function buildClusteringConfigBlock(config: DomainConfig): string {
  return `{
    "mergeThreshold": ${config.mergeThreshold},
    "threadMatchScore": 100,
    "tagMatchScore": 15,
    "subjectMatchScore": 20,
    "actorAffinityScore": 10,
    "subjectAdditiveBonus": 5,
    "timeDecayDays": { "fresh": ${config.timeDecayFresh}, "recent": 120, "stale": 365 },
    "weakTagDiscount": 0.5,
    "frequencyThreshold": 0.1,
    "anchorTagLimit": 3,
    "caseSizeThreshold": ${config.caseSizeThreshold},
    "caseSizeMaxBonus": 10,
    "reminderCollapseEnabled": ${config.reminderCollapseEnabled},
    "reminderSubjectSimilarity": 0.85,
    "reminderMaxAge": 7
  }`;
}

function buildGoalAdjustments(goals: string[]): string {
  const goalsLower = goals.map((g) => g.toLowerCase()).join(" ");
  const adjustments: string[] = [];

  if (
    goalsLower.includes("deadline") ||
    goalsLower.includes("due date") ||
    goalsLower.includes("schedule")
  ) {
    adjustments.push('- If a "deadline" or "eventDate" field exists, set showOnCard: true');
  }
  if (
    goalsLower.includes("cost") ||
    goalsLower.includes("money") ||
    goalsLower.includes("budget") ||
    goalsLower.includes("financial")
  ) {
    adjustments.push('- If a "cost", "amount", or "budget" field exists, set showOnCard: true');
  }
  if (
    goalsLower.includes("progress") ||
    goalsLower.includes("status") ||
    goalsLower.includes("completion")
  ) {
    adjustments.push('- If a "percentComplete" or status field exists, set showOnCard: true');
  }

  if (adjustments.length === 0) {
    return "";
  }

  return `\nGoal-based field adjustments (override domain defaults):\n${adjustments.join("\n")}`;
}

function buildSystemPrompt(domain: string): string {
  const config = getDomainConfig(domain);
  const allDomainSummary = Object.entries(DOMAIN_CONFIGS)
    .map(
      ([key, cfg]) =>
        `  - ${key}: mergeThreshold=${cfg.mergeThreshold}, timeDecay.fresh=${cfg.timeDecayFresh}, caseSizeThreshold=${cfg.caseSizeThreshold}, reminderCollapse=${cfg.reminderCollapseEnabled}`,
    )
    .join("\n");

  return `You are a schema configuration expert for an email case management system. Your job is to generate a complete schema hypothesis that configures how a user's emails will be organized into cases.

You have deep knowledge of these email domains and their clustering characteristics:
${allDomainSummary}

For the "${domain}" domain, use these defaults:
- Merge threshold: ${config.mergeThreshold} (lower = more cases, higher = more merging)
- Time decay fresh window: ${config.timeDecayFresh} days
- Case size threshold: ${config.caseSizeThreshold} emails before case splitting is considered
- Reminder collapse: ${config.reminderCollapseEnabled}

Domain-specific tags for "${domain}":
${config.tags.map((t) => `  - "${t.name}": ${t.description} (frequency: ${t.frequency}, actionable: ${t.actionable})`).join("\n")}

Domain-specific extracted fields for "${domain}":
${config.fields.map((f) => `  - "${f.name}": type=${f.type}, showOnCard=${f.showOnCard}, aggregation=${f.aggregation}`).join("\n")}

Summary labels for "${domain}": ${config.summaryLabels.beginning} / ${config.summaryLabels.middle} / ${config.summaryLabels.end}

Typical secondary entity types for "${domain}":
${config.secondaryEntityTypes.map((t) => `  - ${t}`).join("\n")}

Common exclusion patterns: ${config.exclusionHints.join(", ")}

CRITICAL RULES:
1. Return ONLY valid JSON matching the required schema exactly. No explanations, no markdown, no extra text.
2. Include ALL user-provided "whats" as PRIMARY entities with relevant aliases.
3. Include ALL user-provided "whos" as SECONDARY entities, classified into appropriate types.
4. Generate at least 5 domain-specific tags. NEVER use generic tags like "Communication", "General", or "Other".
5. Generate Gmail discovery queries derived from entity names (e.g., "from:coach@school.edu" or "subject:Lincoln Elementary").
6. Use the domain-specific clustering constants shown above.
7. Adjust showOnCard based on user goals (deadlines emphasis -> deadline showOnCard, cost emphasis -> cost showOnCard, schedule emphasis -> eventDate showOnCard).
8. Generate exclusion patterns for common noise senders in this domain.

Required JSON shape:
{
  "domain": string,
  "schemaName": string,
  "primaryEntity": { "name": string, "description": string },
  "secondaryEntityTypes": [{ "name": string, "description": string, "derivedFrom": "sender"|"extracted"|"both", "affinityScore": number }],
  "entities": [{ "name": string, "type": "PRIMARY"|"SECONDARY", "secondaryTypeName": string|null, "aliases": string[], "confidence": number, "source": "user_input"|"email_scan"|"ai_inferred" }],
  "tags": [{ "name": string, "description": string, "expectedFrequency": "high"|"medium"|"low", "isActionable": boolean }],
  "extractedFields": [{ "name": string, "type": "NUMBER"|"STRING"|"DATE"|"BOOLEAN", "description": string, "source": "BODY"|"ATTACHMENT"|"ANY", "format": string, "showOnCard": boolean, "aggregation": "SUM"|"LATEST"|"MAX"|"MIN"|"COUNT"|"FIRST" }],
  "summaryLabels": { "beginning": string, "middle": string, "end": string },
  "clusteringConfig": ${buildClusteringConfigBlock(config)},
  "discoveryQueries": [{ "query": string, "label": string, "entityName": string|null, "source": "entity_name"|"domain_default"|"email_scan" }],
  "exclusionPatterns": string[]
}`;
}

function buildUserPrompt(input: InterviewInput): string {
  const config = getDomainConfig(input.domain);
  const goalAdjustments = buildGoalAdjustments(input.goals);

  return `Generate a schema hypothesis for this user:

Role: ${input.role}
Domain: ${input.domain}

Things they track (PRIMARY entities — each becomes a case boundary):
${input.whats.map((w) => `  - "${w}"`).join("\n")}

People/contacts they interact with (SECONDARY entities — used for affinity scoring):
${input.whos.map((w) => `  - "${w}"`).join("\n")}

Their goals:
${input.goals.map((g) => `  - ${g}`).join("\n")}
${goalAdjustments}

Requirements:
- Every item in the "whats" list MUST appear as a PRIMARY entity with type "PRIMARY", secondaryTypeName null, source "user_input", confidence 1.0, and at least one alias.
- Every item in the "whos" list MUST appear as a SECONDARY entity with type "SECONDARY", an appropriate secondaryTypeName from the domain types (${config.secondaryEntityTypes.join(", ")}), source "user_input", and confidence 1.0.
- Generate discovery queries for Gmail search. For each PRIMARY entity, create a query like "subject:<entity name>" or a relevant Gmail search string. Also include domain-default queries.
- Use summary labels: "${config.summaryLabels.beginning}" / "${config.summaryLabels.middle}" / "${config.summaryLabels.end}"
- Generate exclusion patterns for noise senders (e.g., "${config.exclusionHints[0]}").

Return ONLY the JSON object. No other text.`;
}

/**
 * Builds a prompt pair for Claude to generate a schema hypothesis
 * from interview input. Pure function, no I/O.
 */
export function buildHypothesisPrompt(input: InterviewInput): HypothesisPromptResult {
  return {
    system: buildSystemPrompt(input.domain),
    user: buildUserPrompt(input),
  };
}
