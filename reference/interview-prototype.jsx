import { useCallback, useEffect, useRef, useState } from "react";

// --- DESIGN TOKENS (shared with case feed prototype) ---
const T = {
  bg: "#F7F6F3",
  bgCard: "#FFFFFF",
  bgAccent: "#F0EFEB",
  bgOverlay: "rgba(0,0,0,0.4)",
  text: "#1A1A1A",
  textSecondary: "#6B6B6B",
  textMuted: "#9B9B9B",
  textInverse: "#FFFFFF",
  border: "#E8E6E1",
  borderLight: "#F0EFEB",
  accent: "#2563EB",
  accentSoft: "#EFF4FF",
  accentText: "#1D4ED8",
  success: "#16A34A",
  successSoft: "#ECFDF5",
  successText: "#15803D",
  warn: "#D97706",
  warnSoft: "#FFFBEB",
  warnText: "#B45309",
  error: "#DC2626",
  errorSoft: "#FEF2F2",
  radius: "12px",
  radiusSm: "8px",
  radiusXs: "6px",
  shadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
  shadowLg: "0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)",
  font: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  fontMono: "'JetBrains Mono', 'SF Mono', monospace",
};

// --- SIMULATED AI RESPONSES ---
// In production: Claude API calls. Here: predefined per domain keyword.

function detectDomain(text) {
  const t = text.toLowerCase();
  if (
    t.includes("school") ||
    t.includes("kid") ||
    t.includes("child") ||
    t.includes("parent") ||
    t.includes("soccer") ||
    t.includes("sports")
  )
    return "school_parent";
  if (
    t.includes("rental") ||
    t.includes("property") ||
    t.includes("tenant") ||
    t.includes("landlord") ||
    t.includes("unit")
  )
    return "property";
  if (
    t.includes("construction") ||
    t.includes("renovation") ||
    t.includes("contractor") ||
    t.includes("project manager")
  )
    return "construction";
  if (t.includes("law") || t.includes("attorney") || t.includes("legal") || t.includes("client"))
    return "legal";
  if (
    t.includes("agency") ||
    t.includes("marketing") ||
    t.includes("client") ||
    t.includes("campaign")
  )
    return "agency";
  return "general";
}

const FOLLOW_UPS = {
  school_parent: {
    q1: {
      question: "How do you mainly think about organizing this?",
      options: ["By each child", "By each activity", "All together"],
    },
    q2: {
      question: "Should I track the people involved (teachers, coaches) for each?",
      options: ["Yes, definitely", "Not important"],
    },
  },
  property: {
    q1: {
      question: "How do you mainly organize your work?",
      options: ["By property", "By vendor", "By issue type"],
    },
    q2: {
      question: "Do you want to track costs from invoices and quotes?",
      options: ["Yes, track costs", "Not needed"],
    },
  },
  construction: {
    q1: {
      question: "How do you organize your projects?",
      options: ["By job site / project", "By subcontractor", "By phase"],
    },
    q2: {
      question: "Should I track costs and deadlines from emails?",
      options: ["Yes, both", "Just deadlines", "Not needed"],
    },
  },
  legal: {
    q1: {
      question: "How do you organize your work?",
      options: ["By client / matter", "By case type", "By court / jurisdiction"],
    },
    q2: {
      question: "Should I track deadlines and filing dates?",
      options: ["Yes, critical", "Nice to have"],
    },
  },
  agency: {
    q1: {
      question: "How do you organize your projects?",
      options: ["By client", "By campaign", "By deliverable type"],
    },
    q2: {
      question: "Should I track deadlines and deliverable status?",
      options: ["Yes, track both", "Just deadlines"],
    },
  },
  general: {
    q1: {
      question: "What's the main way you'd group these emails?",
      options: ["By project / topic", "By person", "By time period"],
    },
    q2: {
      question: "Is there specific information you want pulled from emails?",
      options: ["Dates and deadlines", "Costs and amounts", "Action items", "Not sure yet"],
    },
  },
};

const HYPOTHESES = {
  school_parent: {
    domain: "school_parent",
    primaryEntity: {
      name: "Activity",
      description: "A school or sports activity your child participates in",
    },
    entities: [
      { name: "Vail Mountain School", type: "primary", confidence: 0.95, source: "description" },
      {
        name: "Eagle Valley Soccer Club",
        type: "primary",
        confidence: 0.92,
        source: "description",
      },
    ],
    secondaryTypes: [
      { name: "Teacher / Coach", derivedFrom: "sender", affinityScore: 25 },
      { name: "School Admin", derivedFrom: "sender", affinityScore: 15 },
      { name: "Team Parent", derivedFrom: "sender", affinityScore: 10 },
    ],
    tags: [
      {
        name: "Action Required",
        freq: "high",
        actionable: true,
        desc: "Parent needs to do something",
      },
      { name: "Schedule", freq: "high", actionable: true, desc: "Date, time, or calendar event" },
      {
        name: "Payment",
        freq: "medium",
        actionable: true,
        desc: "Fee, registration, or fundraiser cost",
      },
      {
        name: "Permission / Form",
        freq: "medium",
        actionable: true,
        desc: "Document requiring signature",
      },
      {
        name: "Game / Match",
        freq: "medium",
        actionable: true,
        desc: "Athletic competition with date/location",
      },
      { name: "Practice", freq: "high", actionable: false, desc: "Regular training session" },
      {
        name: "Cancellation",
        freq: "low",
        actionable: true,
        desc: "Event cancelled or rescheduled",
      },
      { name: "Volunteer", freq: "low", actionable: true, desc: "Request for parent help" },
    ],
    summaryLabels: { beginning: "What", middle: "Details", end: "Action Needed" },
    extractedFields: [
      {
        name: "eventDate",
        type: "date",
        desc: "Date/time of events, practices, games",
        showOnCard: true,
      },
      {
        name: "eventLocation",
        type: "string",
        desc: "Field, gym, school location",
        showOnCard: false,
      },
      { name: "amount", type: "number", desc: "Payment amount for fees", showOnCard: false },
    ],
    clusteringHighlights: {
      mergeThreshold: 35,
      timeDecayFresh: 60,
      reminderCollapse: true,
      rationale:
        "School events are planned months ahead with frequent reminders. Looser clustering and long time horizons.",
    },
  },
  property: {
    domain: "property",
    primaryEntity: { name: "Property", description: "A rental property or unit you manage" },
    entities: [
      { name: "123 Main St", type: "primary", confidence: 0.88, source: "email_scan" },
      { name: "456 Oak Ave", type: "primary", confidence: 0.85, source: "email_scan" },
      { name: "789 Elm St", type: "primary", confidence: 0.82, source: "email_scan" },
    ],
    secondaryTypes: [
      { name: "Vendor", derivedFrom: "sender", affinityScore: 30 },
      { name: "Tenant", derivedFrom: "sender", affinityScore: 20 },
    ],
    tags: [
      { name: "Maintenance", freq: "high", actionable: true, desc: "Repair or maintenance needed" },
      { name: "Tenant", freq: "medium", actionable: false, desc: "Tenant communication" },
      { name: "Vendor", freq: "high", actionable: false, desc: "Service provider work" },
      { name: "Financial", freq: "medium", actionable: true, desc: "Invoice, payment, budget" },
      { name: "Lease", freq: "low", actionable: true, desc: "Lease agreement or renewal" },
      { name: "Inspection", freq: "low", actionable: true, desc: "Property inspection" },
      { name: "Compliance", freq: "low", actionable: true, desc: "Code or regulation compliance" },
      { name: "Emergency", freq: "low", actionable: true, desc: "Urgent issue" },
    ],
    summaryLabels: { beginning: "Issue", middle: "Activity", end: "Status" },
    extractedFields: [
      {
        name: "cost",
        type: "number",
        desc: "Dollar amount from invoices/quotes",
        showOnCard: true,
      },
      { name: "deadline", type: "date", desc: "Due date for lease, inspection", showOnCard: false },
    ],
    clusteringHighlights: {
      mergeThreshold: 45,
      timeDecayFresh: 45,
      reminderCollapse: false,
      rationale: "Standard property management flow. Cases resolve in weeks. Proven TCS defaults.",
    },
  },
};

// Fallback for domains not fully mocked
function getHypothesis(domain) {
  return HYPOTHESES[domain] || HYPOTHESES["school_parent"];
}

// --- SIMULATED EMAIL SCAN DATA ---
const SCAN_DISCOVERIES = {
  school_parent: [
    { domain: "vailmountainschool.org", count: 34, label: "Vail Mountain School" },
    { domain: "eaglevalleysc.org", count: 18, label: "Eagle Valley Soccer" },
    { domain: "teamsnap.com", count: 12, label: "TeamSnap (automated)" },
    { domain: "parentportal.com", count: 8, label: "Parent Portal" },
    { domain: "gmail.com", count: 45, label: "Personal contacts" },
  ],
  property: [
    { domain: "quickfixplumbing.com", count: 8, label: "Quick Fix Plumbing" },
    { domain: "peakroofing.com", count: 5, label: "Peak Roofing" },
    { domain: "appfolio.com", count: 22, label: "AppFolio (automated)" },
    { domain: "gmail.com", count: 38, label: "Personal contacts" },
    { domain: "statefarm.com", count: 6, label: "State Farm Insurance" },
  ],
};

// --- ICONS ---
const Icons = {
  mail: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 4L12 13L2 4" />
    </svg>
  ),
  check: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <path d="M5 12L10 17L19 7" />
    </svg>
  ),
  x: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M18 6L6 18M6 6L18 18" />
    </svg>
  ),
  edit: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  plus: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M12 5V19M5 12H19" />
    </svg>
  ),
  sparkle: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" />
    </svg>
  ),
  shield: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  search: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21L16.65 16.65" />
    </svg>
  ),
  arrow: (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12H19M12 5L19 12L12 19" />
    </svg>
  ),
  back: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 4L6 10L12 16" />
    </svg>
  ),
};

// --- REUSABLE COMPONENTS ---

function ProgressDots({ current, total }) {
  return (
    <div style={{ display: "flex", gap: "6px", justifyContent: "center", padding: "16px 0 8px" }}>
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          style={{
            width: i === current ? "24px" : "8px",
            height: "8px",
            borderRadius: "4px",
            background: i <= current ? T.accent : T.border,
            transition: "all 0.3s ease",
          }}
        />
      ))}
    </div>
  );
}

function Tag({ label, active = true, actionable, onRemove, onToggle, size = "normal" }) {
  const isSmall = size === "small";
  return (
    <span
      onClick={onToggle}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: isSmall ? "2px 8px" : "5px 12px",
        borderRadius: "100px",
        fontSize: isSmall ? "11px" : "12px",
        fontWeight: 500,
        background: active ? (actionable ? T.warnSoft : T.accentSoft) : T.bgAccent,
        color: active ? (actionable ? T.warnText : T.accentText) : T.textMuted,
        cursor: onToggle ? "pointer" : "default",
        transition: "all 0.15s",
        textDecoration: active ? "none" : "line-through",
        opacity: active ? 1 : 0.6,
      }}
    >
      {label}
      {actionable && active && <span style={{ fontSize: "9px" }}>!</span>}
      {onRemove && (
        <span
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          style={{ cursor: "pointer", display: "flex", marginLeft: "2px" }}
        >
          {Icons.x}
        </span>
      )}
    </span>
  );
}

function EntityCard({ entity, onRemove, onEdit }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 12px",
        borderRadius: T.radiusSm,
        border: `1px solid ${T.border}`,
        background: T.bgCard,
      }}
    >
      <div>
        <div style={{ fontSize: "13px", fontWeight: 500, color: T.text }}>{entity.name}</div>
        <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "1px" }}>
          {entity.source === "description"
            ? "From your description"
            : entity.source === "user_added"
              ? "Added by you"
              : "Found in email"}
          {entity.confidence < 0.9 &&
            entity.source !== "user_added" &&
            ` (${Math.round(entity.confidence * 100)}% match)`}
        </div>
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        {onEdit && (
          <span onClick={onEdit} style={{ cursor: "pointer", color: T.textMuted, display: "flex" }}>
            {Icons.edit}
          </span>
        )}
        {onRemove && (
          <span
            onClick={onRemove}
            style={{ cursor: "pointer", color: T.textMuted, display: "flex" }}
          >
            {Icons.x}
          </span>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// CARD 1: TWO-STEP GUIDED INPUT
// =============================================================================
//
// Step 1: Role (one tap) -> sets domain, cascades to all AI-generated config
// Step 2: What + Who names (type + add) -> creates entities + discovery queries
//
// No follow-up questions. No context textarea.
// The AI infers refinements from role + names.
// The email scan (Card 3) discovers everything else.
// =============================================================================

const ROLE_OPTIONS = [
  { id: "parent", label: "Parent / Family", icon: "👨‍👩‍👧‍👦", domain: "school_parent" },
  { id: "property", label: "Property Manager", icon: "🏠", domain: "property" },
  { id: "construction", label: "Construction / Contractor", icon: "🔨", domain: "construction" },
  { id: "legal", label: "Attorney / Legal", icon: "⚖️", domain: "legal" },
  { id: "agency", label: "Agency / Consulting", icon: "📊", domain: "agency" },
  { id: "other", label: "Something else", icon: "✨", domain: "general" },
];

const DOMAIN_CONFIGS = {
  school_parent: {
    whatLabel: "The schools, teams, or activities",
    whatPlaceholder: 'e.g. "Vail Mountain School"',
    whatHint: "Each one becomes a separate organized group in your feed.",
    whoLabel: "Teachers, coaches, or key contacts",
    whoPlaceholder: 'e.g. "Coach Martinez" or "Mrs. Patterson"',
    whoHint: "We'll use these to connect emails to the right activity.",
    reassurance: "Just the ones you can think of. We'll discover more from your email.",
    goals: [
      { id: "deadlines", label: "Never miss a deadline", icon: "📅" },
      { id: "actions", label: "Know what I need to do", icon: "✅" },
      { id: "schedule", label: "Keep track of schedules", icon: "🗓️" },
      { id: "costs", label: "Track payments and fees", icon: "💰" },
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
      { id: "costs", label: "Track repair costs", icon: "💰" },
      { id: "actions", label: "Stay on top of maintenance", icon: "🔧" },
      { id: "deadlines", label: "Never miss a lease deadline", icon: "📅" },
      { id: "status", label: "Know what needs attention", icon: "👀" },
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
      { id: "costs", label: "Track project costs", icon: "💰" },
      { id: "deadlines", label: "Hit every deadline", icon: "📅" },
      { id: "actions", label: "Know what needs my attention", icon: "👀" },
      { id: "permits", label: "Keep permits on track", icon: "📋" },
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
      { id: "deadlines", label: "Never miss a filing deadline", icon: "📅" },
      { id: "actions", label: "Know what needs my attention", icon: "👀" },
      { id: "status", label: "Track matter status", icon: "📊" },
      { id: "billing", label: "Track billable activity", icon: "💰" },
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
      { id: "deadlines", label: "Hit every deliverable deadline", icon: "📅" },
      { id: "actions", label: "Know what clients are waiting on", icon: "👀" },
      { id: "status", label: "Track project progress", icon: "📊" },
      { id: "costs", label: "Track budgets and invoices", icon: "💰" },
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
      { id: "actions", label: "Know what I need to do", icon: "✅" },
      { id: "deadlines", label: "Never miss a deadline", icon: "📅" },
      { id: "status", label: "See what's happening at a glance", icon: "👀" },
      { id: "organized", label: "Just get it organized", icon: "📂" },
    ],
  },
};

function Card1({ onNext }) {
  const [step, setStep] = useState(1); // 1: role, 2: names
  const [role, setRole] = useState(null);
  const [whats, setWhats] = useState([]);
  const [whos, setWhos] = useState([]);
  const [currentWhat, setCurrentWhat] = useState("");
  const [currentWho, setCurrentWho] = useState("");
  const [showWho, setShowWho] = useState(false);
  const [goals, setGoals] = useState([]);
  const whatRef = useRef(null);
  const whoRef = useRef(null);

  const domain = role ? ROLE_OPTIONS.find((r) => r.id === role)?.domain : null;
  const dc = domain ? DOMAIN_CONFIGS[domain] : null;

  const handleSelectRole = (r) => {
    setRole(r.id);
    setTimeout(() => {
      setStep(2);
      setTimeout(() => whatRef.current?.focus(), 150);
    }, 200);
  };

  const handleAddWhat = () => {
    const trimmed = currentWhat.trim();
    if (trimmed && !whats.includes(trimmed)) {
      setWhats((prev) => [...prev, trimmed]);
      setCurrentWhat("");
      setTimeout(() => whatRef.current?.focus(), 50);
    }
  };

  const handleAddWho = () => {
    const trimmed = currentWho.trim();
    if (trimmed && !whos.includes(trimmed)) {
      setWhos((prev) => [...prev, trimmed]);
      setCurrentWho("");
      setTimeout(() => whoRef.current?.focus(), 50);
    }
  };

  const handleRemoveWhat = (i) => setWhats((prev) => prev.filter((_, idx) => idx !== i));
  const handleRemoveWho = (i) => setWhos((prev) => prev.filter((_, idx) => idx !== i));

  const handleContinue = () => {
    onNext({
      description: `${ROLE_OPTIONS.find((r) => r.id === role)?.label}. Topics: ${whats.join(", ")}. People: ${whos.join(", ")}. Goals: ${goals.join(", ")}.`,
      domain,
      interviewResponses: { role, whats, whos, goals },
      whats,
      whos,
      goals,
    });
  };

  const canContinue = whats.length >= 1;

  return (
    <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", height: "100%" }}>
      <ProgressDots current={0} total={4} />

      <div style={{ flex: 1, overflow: "auto" }}>
        {/* Header - changes per step */}
        <div style={{ marginBottom: "16px", marginTop: "12px" }}>
          <h2
            style={{
              fontSize: "20px",
              fontWeight: 700,
              color: T.text,
              margin: "0 0 6px",
              letterSpacing: "-0.02em",
              lineHeight: 1.2,
            }}
          >
            {step === 1 ? "Let's organize one topic at a time." : "Name the key players"}
          </h2>
          <p style={{ fontSize: "13px", color: T.textSecondary, margin: 0, lineHeight: 1.4 }}>
            {step === 1
              ? "First, tell me about yourself."
              : "We'll use these names to search your email. You don't have to list them all."}
          </p>
        </div>

        {/* Step 1: Role selection */}
        {step === 1 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {ROLE_OPTIONS.map((r) => (
              <div
                key={r.id}
                onClick={() => handleSelectRole(r)}
                style={{
                  padding: "12px 14px",
                  borderRadius: T.radiusSm,
                  border: `1.5px solid ${T.border}`,
                  background: T.bgCard,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = T.accent;
                  e.currentTarget.style.background = T.accentSoft;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = T.border;
                  e.currentTarget.style.background = T.bgCard;
                }}
              >
                <span style={{ fontSize: "18px" }}>{r.icon}</span>
                <span style={{ fontSize: "14px", fontWeight: 500, color: T.text }}>{r.label}</span>
              </div>
            ))}
          </div>
        ) : (
          /* Step 2: Names (what + who) */
          <div style={{ animation: "fadeIn 0.3s ease" }}>
            {/* Role badge - tap to go back and change */}
            <div
              onClick={() => {
                setStep(1);
                setRole(null);
                setWhats([]);
                setWhos([]);
                setCurrentWhat("");
                setCurrentWho("");
                setShowWho(false);
                setGoals([]);
              }}
              style={{
                padding: "8px 12px",
                borderRadius: T.radiusSm,
                background: T.accentSoft,
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "13px",
                color: T.accentText,
                fontWeight: 500,
                marginBottom: "16px",
                cursor: "pointer",
                transition: "all 0.15s",
                border: `1px solid transparent`,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = T.accent)}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "transparent")}
            >
              <span style={{ display: "flex", color: T.accentText, opacity: 0.5 }}>
                {Icons.back}
              </span>
              <span>{ROLE_OPTIONS.find((r) => r.id === role)?.icon}</span>
              {ROLE_OPTIONS.find((r) => r.id === role)?.label}
            </div>

            {/* WHAT section */}
            {dc && (
              <>
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: T.accentText,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: "4px",
                  }}
                >
                  {dc.whatLabel}
                </div>
                <div style={{ fontSize: "12px", color: T.textMuted, marginBottom: "8px" }}>
                  {dc.whatHint}
                </div>

                {whats.length > 0 && (
                  <div
                    style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px" }}
                  >
                    {whats.map((name, i) => (
                      <span
                        key={i}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "6px 12px",
                          borderRadius: "100px",
                          background: T.accentSoft,
                          color: T.accentText,
                          fontSize: "13px",
                          fontWeight: 500,
                        }}
                      >
                        {name}
                        <span
                          onClick={() => handleRemoveWhat(i)}
                          style={{ cursor: "pointer", display: "flex", opacity: 0.6 }}
                        >
                          {Icons.x}
                        </span>
                      </span>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", gap: "6px", marginBottom: "16px" }}>
                  <input
                    ref={whatRef}
                    value={currentWhat}
                    onChange={(e) => setCurrentWhat(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddWhat();
                      }
                    }}
                    placeholder={dc.whatPlaceholder}
                    style={{
                      flex: 1,
                      padding: "11px 14px",
                      borderRadius: T.radiusSm,
                      border: `1.5px solid ${currentWhat ? T.accent : T.border}`,
                      fontSize: "14px",
                      fontFamily: T.font,
                      color: T.text,
                      outline: "none",
                      transition: "border-color 0.15s",
                    }}
                  />
                  <button
                    onClick={handleAddWhat}
                    disabled={!currentWhat.trim()}
                    style={{
                      padding: "11px 16px",
                      borderRadius: T.radiusSm,
                      border: "none",
                      background: currentWhat.trim() ? T.accent : T.bgAccent,
                      color: currentWhat.trim() ? T.textInverse : T.textMuted,
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: currentWhat.trim() ? "pointer" : "default",
                      fontFamily: T.font,
                      whiteSpace: "nowrap",
                    }}
                  >
                    Add
                  </button>
                </div>

                {/* WHO section - appears after at least one WHAT */}
                {whats.length > 0 && (
                  <>
                    {!showWho ? (
                      <div
                        onClick={() => {
                          setShowWho(true);
                          setTimeout(() => whoRef.current?.focus(), 100);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "10px 14px",
                          borderRadius: T.radiusSm,
                          border: `1.5px dashed ${T.border}`,
                          background: "transparent",
                          cursor: "pointer",
                          fontSize: "13px",
                          fontWeight: 500,
                          color: T.textSecondary,
                          fontFamily: T.font,
                          width: "100%",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = T.warn;
                          e.currentTarget.style.color = T.warnText;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = T.border;
                          e.currentTarget.style.color = T.textSecondary;
                        }}
                      >
                        {Icons.plus} Now add some of the people involved (recommended)
                      </div>
                    ) : (
                      <div style={{ animation: "fadeIn 0.2s ease" }}>
                        <div
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            color: T.warnText,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            marginBottom: "4px",
                          }}
                        >
                          {dc.whoLabel}
                        </div>
                        <div style={{ fontSize: "12px", color: T.textMuted, marginBottom: "8px" }}>
                          {dc.whoHint}
                        </div>

                        {whos.length > 0 && (
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: "6px",
                              marginBottom: "8px",
                            }}
                          >
                            {whos.map((name, i) => (
                              <span
                                key={i}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  padding: "6px 12px",
                                  borderRadius: "100px",
                                  background: T.warnSoft,
                                  color: T.warnText,
                                  fontSize: "13px",
                                  fontWeight: 500,
                                }}
                              >
                                {name}
                                <span
                                  onClick={() => handleRemoveWho(i)}
                                  style={{ cursor: "pointer", display: "flex", opacity: 0.6 }}
                                >
                                  {Icons.x}
                                </span>
                              </span>
                            ))}
                          </div>
                        )}

                        <div style={{ display: "flex", gap: "6px" }}>
                          <input
                            ref={whoRef}
                            value={currentWho}
                            onChange={(e) => setCurrentWho(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddWho();
                              }
                            }}
                            placeholder={dc.whoPlaceholder}
                            style={{
                              flex: 1,
                              padding: "11px 14px",
                              borderRadius: T.radiusSm,
                              border: `1.5px solid ${currentWho ? T.warn : T.border}`,
                              fontSize: "14px",
                              fontFamily: T.font,
                              color: T.text,
                              outline: "none",
                              transition: "border-color 0.15s",
                            }}
                          />
                          <button
                            onClick={handleAddWho}
                            disabled={!currentWho.trim()}
                            style={{
                              padding: "11px 16px",
                              borderRadius: T.radiusSm,
                              border: "none",
                              background: currentWho.trim() ? T.warn : T.bgAccent,
                              color: currentWho.trim() ? T.textInverse : T.textMuted,
                              fontSize: "13px",
                              fontWeight: 600,
                              cursor: currentWho.trim() ? "pointer" : "default",
                              fontFamily: T.font,
                              whiteSpace: "nowrap",
                            }}
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Reassurance */}
                    <div
                      style={{
                        marginTop: "14px",
                        padding: "10px 12px",
                        borderRadius: T.radiusSm,
                        background: T.bgAccent,
                        fontSize: "12px",
                        color: T.textMuted,
                        lineHeight: 1.4,
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "8px",
                      }}
                    >
                      <span
                        style={{
                          display: "flex",
                          flexShrink: 0,
                          marginTop: "1px",
                          color: T.accent,
                        }}
                      >
                        {Icons.sparkle}
                      </span>
                      <span>{dc.reassurance}</span>
                    </div>

                    {/* Goals - "What matters most?" */}
                    {dc.goals && (
                      <div style={{ marginTop: "16px" }}>
                        <div
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            color: T.successText,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            marginBottom: "6px",
                          }}
                        >
                          What matters most to you?
                        </div>
                        <div style={{ fontSize: "12px", color: T.textMuted, marginBottom: "8px" }}>
                          Pick any that apply. This helps us know what to surface first.
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                          {dc.goals.map((g) => {
                            const selected = goals.includes(g.id);
                            return (
                              <button
                                key={g.id}
                                onClick={() =>
                                  setGoals((prev) =>
                                    selected ? prev.filter((x) => x !== g.id) : [...prev, g.id],
                                  )
                                }
                                style={{
                                  padding: "7px 12px",
                                  borderRadius: "100px",
                                  border: `1.5px solid ${selected ? T.success : T.border}`,
                                  background: selected ? T.successSoft : T.bgCard,
                                  color: selected ? T.successText : T.textSecondary,
                                  fontSize: "12px",
                                  fontWeight: 500,
                                  cursor: "pointer",
                                  fontFamily: T.font,
                                  transition: "all 0.15s",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "5px",
                                }}
                              >
                                <span style={{ fontSize: "13px" }}>{g.icon}</span>
                                {g.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Bottom CTA */}
      {canContinue && (
        <button
          onClick={handleContinue}
          style={{
            marginTop: "12px",
            padding: "14px",
            borderRadius: T.radiusSm,
            border: "none",
            background: T.accent,
            color: T.textInverse,
            fontSize: "15px",
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: T.font,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            animation: "fadeIn 0.3s ease",
          }}
        >
          Connect my email {Icons.arrow}
        </button>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
// =============================================================================
// CARD 2: CONNECT GMAIL
// =============================================================================

function Card2({ onNext }) {
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);

  const handleConnect = () => {
    setConnecting(true);
    setTimeout(() => {
      setConnecting(false);
      setConnected(true);
      setTimeout(() => onNext(), 800);
    }, 1500);
  };

  return (
    <div
      style={{
        padding: "24px 20px",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <ProgressDots current={1} total={4} />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
          maxWidth: "320px",
        }}
      >
        <div
          style={{
            width: "64px",
            height: "64px",
            borderRadius: "50%",
            background: connected ? T.successSoft : T.accentSoft,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "20px",
            color: connected ? T.success : T.accent,
            transition: "all 0.3s",
          }}
        >
          {connected ? Icons.check : Icons.mail}
        </div>

        <h2
          style={{
            fontSize: "22px",
            fontWeight: 700,
            color: T.text,
            margin: "0 0 8px",
            letterSpacing: "-0.02em",
          }}
        >
          {connected ? "Connected!" : "Connect your email"}
        </h2>
        <p
          style={{ fontSize: "14px", color: T.textSecondary, margin: "0 0 24px", lineHeight: 1.5 }}
        >
          {connected
            ? "Starting to analyze your email..."
            : "We'll read your email to organize it into cases. We never send, delete, or modify your email."}
        </p>

        {!connected && (
          <>
            <button
              onClick={handleConnect}
              disabled={connecting}
              style={{
                padding: "14px 28px",
                borderRadius: T.radiusSm,
                border: "none",
                background: connecting ? T.bgAccent : T.accent,
                color: connecting ? T.textMuted : T.textInverse,
                fontSize: "15px",
                fontWeight: 600,
                cursor: connecting ? "default" : "pointer",
                fontFamily: T.font,
                display: "flex",
                alignItems: "center",
                gap: "10px",
                transition: "all 0.15s",
              }}
            >
              {connecting ? (
                <>Connecting...</>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  Sign in with Google
                </>
              )}
            </button>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginTop: "20px",
                padding: "10px 14px",
                borderRadius: T.radiusSm,
                background: T.bgAccent,
                fontSize: "12px",
                color: T.textMuted,
              }}
            >
              <span style={{ display: "flex", color: T.textMuted }}>{Icons.shield}</span>
              Read-only access. Your email stays in Gmail.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// CARD 3: ANALYZING YOUR EMAIL
// =============================================================================

function Card3({ domain, onNext }) {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("scanning"); // scanning | classifying | done
  const [discoveries, setDiscoveries] = useState([]);
  const scanData = SCAN_DISCOVERIES[domain] || SCAN_DISCOVERIES["school_parent"];

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 187) {
          clearInterval(interval);
          return 187;
        }
        return prev + Math.floor(Math.random() * 8) + 3;
      });
    }, 120);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (progress > 40) setPhase("classifying");
    if (progress >= 187) {
      setPhase("done");
      setTimeout(() => onNext(), 1200);
    }
  }, [progress, onNext]);

  useEffect(() => {
    const timeouts = scanData.map((d, i) =>
      setTimeout(() => setDiscoveries((prev) => [...prev, d]), 600 + i * 500),
    );
    return () => timeouts.forEach(clearTimeout);
  }, []);

  return (
    <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", height: "100%" }}>
      <ProgressDots current={2} total={4} />

      <div style={{ marginTop: "16px", marginBottom: "20px" }}>
        <h2
          style={{
            fontSize: "22px",
            fontWeight: 700,
            color: T.text,
            margin: "0 0 8px",
            letterSpacing: "-0.02em",
          }}
        >
          Analyzing your email...
        </h2>
        <p style={{ fontSize: "14px", color: T.textSecondary, margin: 0 }}>
          {phase === "scanning" && "Scanning your recent emails..."}
          {phase === "classifying" && "Testing our hypothesis against your email..."}
          {phase === "done" && "Analysis complete. Building your schema..."}
        </p>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
          <span style={{ fontSize: "12px", color: T.textMuted }}>Emails processed</span>
          <span
            style={{ fontSize: "12px", fontWeight: 600, color: T.text, fontFamily: T.fontMono }}
          >
            {Math.min(progress, 187)}
          </span>
        </div>
        <div
          style={{
            height: "6px",
            background: T.bgAccent,
            borderRadius: "3px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${Math.min((progress / 187) * 100, 100)}%`,
              height: "100%",
              background: phase === "done" ? T.success : T.accent,
              borderRadius: "3px",
              transition: "width 0.3s ease, background 0.3s ease",
            }}
          />
        </div>
      </div>

      {/* Discoveries */}
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: T.textMuted,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: "10px",
          }}
        >
          Sender Domains Found
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {discoveries.map((d, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 12px",
                borderRadius: T.radiusSm,
                border: `1px solid ${T.border}`,
                background: T.bgCard,
                animation: "fadeIn 0.3s ease",
              }}
            >
              <div>
                <div style={{ fontSize: "13px", fontWeight: 500, color: T.text }}>{d.label}</div>
                <div style={{ fontSize: "11px", color: T.textMuted }}>{d.domain}</div>
              </div>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  fontFamily: T.fontMono,
                  color: T.accent,
                  background: T.accentSoft,
                  padding: "2px 8px",
                  borderRadius: "100px",
                }}
              >
                {d.count}
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}

// =============================================================================
// CARD 4: HYPOTHESIS REVIEW
// =============================================================================

function Card4({ domain, card1Data, onFinalize }) {
  const hypothesis = getHypothesis(domain);
  const [entities, setEntities] = useState(
    hypothesis.entities.map((e) => ({ ...e, active: true })),
  );
  const [tags, setTags] = useState(hypothesis.tags.map((t) => ({ ...t, active: true })));
  const [addingTag, setAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [addingEntity, setAddingEntity] = useState(false);
  const [newEntityName, setNewEntityName] = useState("");
  const [section, setSection] = useState("all");
  const [confirmed, setConfirmed] = useState(false);

  const handleRemoveEntity = (i) => {
    setEntities((prev) => prev.map((e, idx) => (idx === i ? { ...e, active: !e.active } : e)));
  };

  const handleAddEntity = () => {
    if (newEntityName.trim()) {
      setEntities((prev) => [
        ...prev,
        {
          name: newEntityName.trim(),
          type: "primary",
          confidence: 1.0,
          source: "user_added",
          active: true,
        },
      ]);
      setNewEntityName("");
      setAddingEntity(false);
    }
  };

  const handleToggleTag = (i) => {
    setTags((prev) => prev.map((t, idx) => (idx === i ? { ...t, active: !t.active } : t)));
  };

  const handleAddTag = () => {
    if (newTagName.trim()) {
      setTags((prev) => [
        ...prev,
        {
          name: newTagName.trim(),
          freq: "medium",
          actionable: false,
          desc: "Custom tag",
          active: true,
        },
      ]);
      setNewTagName("");
      setAddingTag(false);
    }
  };

  const handleFinalize = () => {
    setConfirmed(true);
    setTimeout(() => {
      onFinalize({
        hypothesis,
        entities: entities.filter((e) => e.active),
        tags: tags.filter((t) => t.active),
      });
    }, 1500);
  };

  if (confirmed) {
    return (
      <div
        style={{
          padding: "24px 20px",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: "72px",
            height: "72px",
            borderRadius: "50%",
            background: T.successSoft,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "20px",
            color: T.success,
          }}
        >
          {Icons.check}
        </div>
        <h2 style={{ fontSize: "22px", fontWeight: 700, color: T.text, margin: "0 0 8px" }}>
          You're all set!
        </h2>
        <p style={{ fontSize: "14px", color: T.textSecondary, margin: "0 0 4px", lineHeight: 1.5 }}>
          Scanning your email and building your cases now.
        </p>
        <p style={{ fontSize: "13px", color: T.textMuted, margin: 0, lineHeight: 1.5 }}>
          This usually takes about a minute. Your cases will appear as they're ready.
        </p>

        {/* Animated scanning indicator */}
        <div
          style={{
            marginTop: "24px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div
            style={{
              width: "200px",
              height: "4px",
              borderRadius: "2px",
              background: T.bgAccent,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: "40%",
                height: "100%",
                borderRadius: "2px",
                background: T.accent,
                animation: "scanSlide 1.5s ease-in-out infinite",
              }}
            />
          </div>
          <div style={{ fontSize: "12px", color: T.textMuted }}>
            {entities.filter((e) => e.active).length} topics / {tags.filter((t) => t.active).length}{" "}
            categories
          </div>
        </div>

        <style>{`
          @keyframes scanSlide {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(350%); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "16px 20px 0" }}>
        <ProgressDots current={3} total={4} />
        <h2
          style={{
            fontSize: "20px",
            fontWeight: 700,
            color: T.text,
            margin: "12px 0 4px",
            letterSpacing: "-0.02em",
          }}
        >
          Here's what I set up
        </h2>
        <p
          style={{ fontSize: "13px", color: T.textSecondary, margin: "0 0 12px", lineHeight: 1.4 }}
        >
          Review and adjust. Remove anything that's wrong, add anything missing.
        </p>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 20px" }}>
        {/* Primary Entity */}
        <div style={{ marginBottom: "20px" }}>
          <div
            style={{
              fontSize: "10px",
              fontWeight: 600,
              color: T.textMuted,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: "8px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span style={{ color: T.accent, display: "flex" }}>{Icons.sparkle}</span>
            Organizing by: {hypothesis.primaryEntity.name}
          </div>
          <div style={{ fontSize: "12px", color: T.textSecondary, marginBottom: "10px" }}>
            {hypothesis.primaryEntity.description}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {entities.map((e, i) => (
              <div key={i} style={{ opacity: e.active ? 1 : 0.4, transition: "opacity 0.15s" }}>
                <EntityCard entity={e} onRemove={() => handleRemoveEntity(i)} />
              </div>
            ))}
            {/* Add entity */}
            {!addingEntity ? (
              <div
                onClick={() => setAddingEntity(true)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  padding: "10px 12px",
                  borderRadius: T.radiusSm,
                  border: `1.5px dashed ${T.border}`,
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: T.accent,
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = T.accent;
                  e.currentTarget.style.background = T.accentSoft;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = T.border;
                  e.currentTarget.style.background = "transparent";
                }}
              >
                {Icons.plus} Add another
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  gap: "6px",
                  padding: "4px",
                  borderRadius: T.radiusSm,
                  border: `1.5px solid ${T.accent}`,
                  background: T.bgCard,
                }}
              >
                <input
                  autoFocus
                  value={newEntityName}
                  onChange={(e) => setNewEntityName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddEntity();
                    if (e.key === "Escape") {
                      setAddingEntity(false);
                      setNewEntityName("");
                    }
                  }}
                  placeholder="Name (as it appears in email)"
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    border: "none",
                    fontSize: "13px",
                    fontFamily: T.font,
                    color: T.text,
                    outline: "none",
                    background: "transparent",
                  }}
                />
                <button
                  onClick={handleAddEntity}
                  disabled={!newEntityName.trim()}
                  style={{
                    padding: "6px 12px",
                    borderRadius: T.radiusXs,
                    border: "none",
                    background: newEntityName.trim() ? T.accent : T.bgAccent,
                    color: newEntityName.trim() ? T.textInverse : T.textMuted,
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: newEntityName.trim() ? "pointer" : "default",
                    fontFamily: T.font,
                  }}
                >
                  Add
                </button>
                <button
                  onClick={() => {
                    setAddingEntity(false);
                    setNewEntityName("");
                  }}
                  style={{
                    padding: "6px",
                    borderRadius: T.radiusXs,
                    border: "none",
                    background: "transparent",
                    color: T.textMuted,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  {Icons.x}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Secondary Entity Types */}
        <div style={{ marginBottom: "20px" }}>
          <div
            style={{
              fontSize: "10px",
              fontWeight: 600,
              color: T.textMuted,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: "8px",
            }}
          >
            People I'll track
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {hypothesis.secondaryTypes.map((st, i) => (
              <span
                key={i}
                style={{
                  padding: "6px 12px",
                  borderRadius: "100px",
                  border: `1px solid ${T.border}`,
                  fontSize: "12px",
                  fontWeight: 500,
                  color: T.textSecondary,
                  background: T.bgCard,
                }}
              >
                {st.name}
              </span>
            ))}
          </div>
        </div>

        {/* Tags */}
        <div style={{ marginBottom: "20px" }}>
          <div
            style={{
              fontSize: "10px",
              fontWeight: 600,
              color: T.textMuted,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: "4px",
            }}
          >
            Categories ({tags.filter((t) => t.active).length} active)
          </div>
          <div style={{ fontSize: "11px", color: T.textMuted, marginBottom: "10px" }}>
            Tap to disable. Orange tags imply you need to take action.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {tags.map((t, i) => (
              <Tag
                key={t.name}
                label={t.name}
                active={t.active}
                actionable={t.actionable}
                onToggle={() => handleToggleTag(i)}
              />
            ))}
            {!addingTag ? (
              <span
                onClick={() => setAddingTag(true)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "5px 12px",
                  borderRadius: "100px",
                  border: `1px dashed ${T.accent}`,
                  fontSize: "12px",
                  fontWeight: 500,
                  color: T.accent,
                  cursor: "pointer",
                }}
              >
                {Icons.plus} Add
              </span>
            ) : (
              <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                <input
                  autoFocus
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                  placeholder="Tag name"
                  style={{
                    padding: "5px 10px",
                    borderRadius: "100px",
                    border: `1.5px solid ${T.accent}`,
                    fontSize: "12px",
                    fontFamily: T.font,
                    outline: "none",
                    width: "120px",
                  }}
                />
                <span
                  onClick={handleAddTag}
                  style={{ cursor: "pointer", color: T.accent, display: "flex" }}
                >
                  {Icons.check}
                </span>
                <span
                  onClick={() => {
                    setAddingTag(false);
                    setNewTagName("");
                  }}
                  style={{ cursor: "pointer", color: T.textMuted, display: "flex" }}
                >
                  {Icons.x}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Summary Labels */}
        <div style={{ marginBottom: "20px" }}>
          <div
            style={{
              fontSize: "10px",
              fontWeight: 600,
              color: T.textMuted,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: "8px",
            }}
          >
            Case Summary Sections
          </div>
          <div
            style={{
              display: "flex",
              gap: "8px",
            }}
          >
            {[
              { label: hypothesis.summaryLabels.beginning, color: T.accent },
              { label: hypothesis.summaryLabels.middle, color: T.warn },
              { label: hypothesis.summaryLabels.end, color: T.success },
            ].map((s, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  borderRadius: T.radiusXs,
                  border: `1px solid ${T.border}`,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: s.color,
                    margin: "0 auto 6px",
                  }}
                />
                <div style={{ fontSize: "12px", fontWeight: 500, color: T.text }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Extracted Fields */}
        <div style={{ marginBottom: "20px" }}>
          <div
            style={{
              fontSize: "10px",
              fontWeight: 600,
              color: T.textMuted,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: "8px",
            }}
          >
            Data I'll pull from emails
          </div>
          {hypothesis.extractedFields.map((f, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 0",
                borderBottom:
                  i < hypothesis.extractedFields.length - 1 ? `1px solid ${T.borderLight}` : "none",
              }}
            >
              <div>
                <div style={{ fontSize: "13px", fontWeight: 500, color: T.text }}>{f.desc}</div>
                <div style={{ fontSize: "11px", color: T.textMuted }}>
                  {f.name} ({f.type})
                </div>
              </div>
              {f.showOnCard && (
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 500,
                    color: T.accentText,
                    background: T.accentSoft,
                    padding: "2px 6px",
                    borderRadius: "100px",
                  }}
                >
                  On card
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Clustering Config Summary */}
        <div style={{ marginBottom: "24px" }}>
          <div
            style={{
              fontSize: "10px",
              fontWeight: 600,
              color: T.textMuted,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: "8px",
            }}
          >
            Clustering Tuning
          </div>
          <div
            style={{
              padding: "12px",
              borderRadius: T.radiusSm,
              background: T.bgAccent,
              fontSize: "12px",
              color: T.textSecondary,
              lineHeight: 1.5,
            }}
          >
            <div style={{ marginBottom: "6px", fontSize: "12px", color: T.text, fontWeight: 500 }}>
              {hypothesis.clusteringHighlights.rationale}
            </div>
            <div
              style={{
                display: "flex",
                gap: "12px",
                flexWrap: "wrap",
                fontFamily: T.fontMono,
                fontSize: "11px",
              }}
            >
              <span>Merge: {hypothesis.clusteringHighlights.mergeThreshold}</span>
              <span>Fresh: {hypothesis.clusteringHighlights.timeDecayFresh}d</span>
              <span>
                Reminders: {hypothesis.clusteringHighlights.reminderCollapse ? "on" : "off"}
              </span>
            </div>
          </div>
        </div>

        <div style={{ height: "80px" }} />
      </div>

      {/* Bottom CTA */}
      <div
        style={{
          padding: "12px 20px",
          borderTop: `1px solid ${T.border}`,
          background: T.bgCard,
        }}
      >
        <button
          onClick={handleFinalize}
          style={{
            width: "100%",
            padding: "14px",
            borderRadius: T.radiusSm,
            border: "none",
            background: T.accent,
            color: T.textInverse,
            fontSize: "15px",
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: T.font,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
          }}
        >
          Looks good, build my cases {Icons.arrow}
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// MAIN APP: INTERVIEW FLOW
// =============================================================================

export default function InterviewPrototype() {
  const [card, setCard] = useState(1);
  const [card1Data, setCard1Data] = useState(null);
  const [domain, setDomain] = useState("school_parent");
  const [finalSchema, setFinalSchema] = useState(null);

  const handleCard1Next = (data) => {
    setCard1Data(data);
    setDomain(data.domain);
    setCard(2);
  };

  const handleCard2Next = () => setCard(3);

  const handleCard3Next = useCallback(() => setCard(4), []);

  const handleFinalize = (schema) => {
    setFinalSchema(schema);
    // In production: redirect to case feed
  };

  const handleRestart = () => {
    setCard(1);
    setCard1Data(null);
    setDomain("school_parent");
    setFinalSchema(null);
  };

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "420px",
        height: "100vh",
        margin: "0 auto",
        fontFamily: T.font,
        overflow: "hidden",
        background: T.bg,
        position: "relative",
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />

      {/* Restart button (dev only) */}
      {card > 1 && !finalSchema && (
        <div
          onClick={handleRestart}
          style={{
            position: "absolute",
            top: "12px",
            left: "12px",
            zIndex: 10,
            cursor: "pointer",
            color: T.textMuted,
            display: "flex",
            alignItems: "center",
            gap: "4px",
            fontSize: "12px",
            padding: "4px 8px",
            borderRadius: T.radiusXs,
            background: T.bgAccent,
          }}
        >
          {Icons.back} Restart
        </div>
      )}

      {card === 1 && <Card1 onNext={handleCard1Next} />}
      {card === 2 && <Card2 onNext={handleCard2Next} />}
      {card === 3 && <Card3 domain={domain} onNext={handleCard3Next} />}
      {card === 4 && <Card4 domain={domain} card1Data={card1Data} onFinalize={handleFinalize} />}
    </div>
  );
}
