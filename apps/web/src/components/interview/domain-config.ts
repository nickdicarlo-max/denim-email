export const ROLE_OPTIONS = [
  {
    id: "parent",
    label: "Parent / Family",
    icon: "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}",
    domain: "school_parent",
  },
  { id: "property", label: "Property Manager", icon: "\u{1F3E0}", domain: "property" },
  {
    id: "construction",
    label: "Construction / Contractor",
    icon: "\u{1F528}",
    domain: "construction",
  },
  { id: "legal", label: "Attorney / Legal", icon: "\u2696\uFE0F", domain: "legal" },
  { id: "agency", label: "Agency / Consulting", icon: "\u{1F4CA}", domain: "agency" },
  { id: "other", label: "Something else", icon: "\u2728", domain: "general" },
] as const;

export type RoleId = (typeof ROLE_OPTIONS)[number]["id"];
export type DomainId = (typeof ROLE_OPTIONS)[number]["domain"];

export interface DomainConfig {
  whatLabel: string;
  whatPlaceholder: string;
  whatHint: string;
  whoLabel: string;
  whoPlaceholder: string;
  whoHint: string;
  reassurance: string;
  goals: { id: string; label: string; icon: string }[];
}

export const DOMAIN_CONFIGS: Record<DomainId, DomainConfig> = {
  school_parent: {
    whatLabel: "The schools, teams, or activities",
    whatPlaceholder: 'e.g. "Vail Mountain School"',
    whatHint: "Each one becomes a separate organized group in your feed.",
    whoLabel: "Teachers, coaches, or key contacts",
    whoPlaceholder: 'e.g. "Coach Martinez" or "Mrs. Patterson"',
    whoHint: "We'll use these to connect emails to the right activity.",
    reassurance: "Just the ones you can think of. We'll discover more from your email.",
    goals: [
      { id: "deadlines", label: "Never miss a deadline", icon: "\u{1F4C5}" },
      { id: "actions", label: "Know what I need to do", icon: "\u2705" },
      { id: "schedule", label: "Keep track of schedules", icon: "\u{1F5D3}\uFE0F" },
      { id: "costs", label: "Track payments and fees", icon: "\u{1F4B0}" },
    ],
  },
  property: {
    whatLabel: "The properties or buildings",
    whatPlaceholder: 'e.g. "123 Main St" or "Oakwood HOA"',
    whatHint: "Each one becomes a separate organized group in your feed.",
    whoLabel: "Vendors, tenants, or key contacts",
    whoPlaceholder: 'e.g. "Quick Fix Plumbing" or "Sarah Chen"',
    whoHint: "Helps us connect emails to the right property.",
    reassurance: "A few is plenty. We'll find the rest from your email.",
    goals: [
      { id: "costs", label: "Track repair costs", icon: "\u{1F4B0}" },
      { id: "actions", label: "Stay on top of maintenance", icon: "\u{1F527}" },
      { id: "deadlines", label: "Never miss a lease deadline", icon: "\u{1F4C5}" },
      { id: "status", label: "Know what needs attention", icon: "\u{1F440}" },
    ],
  },
  construction: {
    whatLabel: "The projects or job sites",
    whatPlaceholder: 'e.g. "Harbor View Renovation"',
    whatHint: "Each project becomes a separate organized group in your feed.",
    whoLabel: "Subcontractors, architects, or key contacts",
    whoPlaceholder: 'e.g. "Comfort Air Solutions" or "Torres Engineering"',
    whoHint: "Helps us track who is working on what.",
    reassurance: "A few key names gets us started. We'll discover the rest.",
    goals: [
      { id: "costs", label: "Track project costs", icon: "\u{1F4B0}" },
      { id: "deadlines", label: "Hit every deadline", icon: "\u{1F4C5}" },
      { id: "actions", label: "Know what needs my attention", icon: "\u{1F440}" },
      { id: "permits", label: "Keep permits on track", icon: "\u{1F4CB}" },
    ],
  },
  legal: {
    whatLabel: "Your clients or matters",
    whatPlaceholder: 'e.g. "Smith v. Jones" or "Acme Corp"',
    whatHint: "Each client or matter becomes its own organized group.",
    whoLabel: "Opposing counsel, courts, or key contacts",
    whoPlaceholder: 'e.g. "Johnson & Associates"',
    whoHint: "Helps us track the parties involved in each matter.",
    reassurance: "Just a few to get started. We'll find more from your threads.",
    goals: [
      { id: "deadlines", label: "Never miss a filing deadline", icon: "\u{1F4C5}" },
      { id: "actions", label: "Know what needs my attention", icon: "\u{1F440}" },
      { id: "status", label: "Track matter status", icon: "\u{1F4CA}" },
      { id: "billing", label: "Track billable activity", icon: "\u{1F4B0}" },
    ],
  },
  agency: {
    whatLabel: "Your clients or projects",
    whatPlaceholder: 'e.g. "Acme Corp rebrand"',
    whatHint: "Each client or project becomes its own organized group.",
    whoLabel: "Client contacts or collaborators",
    whoPlaceholder: 'e.g. "Sarah at Acme"',
    whoHint: "Helps us match emails to the right project.",
    reassurance: "A few names gets us started. We'll find the rest.",
    goals: [
      { id: "deadlines", label: "Hit every deliverable deadline", icon: "\u{1F4C5}" },
      { id: "actions", label: "Know what clients are waiting on", icon: "\u{1F440}" },
      { id: "status", label: "Track project progress", icon: "\u{1F4CA}" },
      { id: "costs", label: "Track budgets and invoices", icon: "\u{1F4B0}" },
    ],
  },
  general: {
    whatLabel: "The topics or projects",
    whatPlaceholder: 'e.g. "Kitchen renovation" or "Book club"',
    whatHint: "Each topic becomes a separate organized group.",
    whoLabel: "Key people involved",
    whoPlaceholder: 'e.g. "Contractor Mike"',
    whoHint: "Helps us connect emails to the right topic.",
    reassurance: "Start with what you can think of. We'll find more.",
    goals: [
      { id: "actions", label: "Know what I need to do", icon: "\u2705" },
      { id: "deadlines", label: "Never miss a deadline", icon: "\u{1F4C5}" },
      { id: "status", label: "See what's happening at a glance", icon: "\u{1F440}" },
      { id: "organized", label: "Just get it organized", icon: "\u{1F4C2}" },
    ],
  },
};
