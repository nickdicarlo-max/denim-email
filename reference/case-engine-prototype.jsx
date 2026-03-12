import { useState } from "react";

// --- DESIGN TOKENS ---
const T = {
  bg: "#F7F6F3",
  bgCard: "#FFFFFF",
  bgCardHover: "#FAFAF8",
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
  errorText: "#B91C1C",
  thumbDown: "#DC2626",
  thumbUp: "#16A34A",
  radius: "12px",
  radiusSm: "8px",
  radiusXs: "6px",
  shadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
  shadowLg: "0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)",
  font: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  fontMono: "'JetBrains Mono', 'SF Mono', monospace",
};

// --- MOCK DATA ---
const MOCK_CASES = [
  {
    id: "c1",
    title: "Kitchen Remodel Permits",
    entity: "Harbor View Renovation",
    secondaryEntity: "City Planning Dept",
    tags: ["Permits", "Timeline"],
    emailCount: 8,
    lastActivity: "2h ago",
    lastSender: "Mike Chen, City Planning",
    status: "active",
    highlight: { label: "Cost", value: "$2,400", format: "currency" },
    summary: {
      beginning:
        "Permit application submitted for kitchen expansion including structural wall removal and new electrical panel.",
      middle:
        "Two rounds of revision requested by city planning. Structural engineer provided updated calculations. Electrical sub-panel approved.",
      end: "Final permit approved pending inspection scheduling.",
    },
    emails: [
      {
        id: "e1",
        subject: "RE: Kitchen permit application #2024-1847",
        sender: "Mike Chen, City Planning",
        date: "2h ago",
        summary: "Final approval granted. Schedule inspection within 30 days.",
        tags: ["Permits"],
        belongsHere: true,
      },
      {
        id: "e2",
        subject: "Updated structural calculations",
        sender: "Sarah Torres, Torres Engineering",
        date: "3 days ago",
        summary:
          "Revised beam load calculations per city comments. PSI rating increased to meet code.",
        tags: ["Permits", "Structural"],
        belongsHere: true,
      },
      {
        id: "e3",
        subject: "RE: Kitchen permit revisions needed",
        sender: "Mike Chen, City Planning",
        date: "1 week ago",
        summary:
          "Second revision request. Need updated electrical load calculations for sub-panel.",
        tags: ["Permits"],
        belongsHere: true,
      },
      {
        id: "e4",
        subject: "Granite countertop samples",
        sender: "Lisa Park, Stone Masters",
        date: "1 week ago",
        summary:
          "Three granite samples shipped. Brazilian Blue, Kashmir White, and Absolute Black. Pricing attached.",
        tags: ["Materials"],
        belongsHere: false,
        betterCase: "Kitchen Materials & Finishes",
      },
      {
        id: "e5",
        subject: "RE: Permit application submitted",
        sender: "Mike Chen, City Planning",
        date: "2 weeks ago",
        summary: "Initial review complete. Revision needed for structural wall removal details.",
        tags: ["Permits"],
        belongsHere: true,
      },
    ],
  },
  {
    id: "c2",
    title: "HVAC System Replacement",
    entity: "Harbor View Renovation",
    secondaryEntity: "Comfort Air Solutions",
    tags: ["HVAC", "Quote"],
    emailCount: 5,
    lastActivity: "1 day ago",
    lastSender: "Dan Wright, Comfort Air",
    status: "active",
    highlight: { label: "Cost", value: "$8,200", format: "currency" },
    summary: {
      beginning: "Existing HVAC system failing. Multiple quotes requested for full replacement.",
      middle:
        "Three bids received. Comfort Air recommended 3-ton split system. Energy audit completed.",
      end: "Awaiting final decision on bid selection.",
    },
    emails: [
      {
        id: "e6",
        subject: "Revised HVAC quote - Option B",
        sender: "Dan Wright, Comfort Air",
        date: "1 day ago",
        summary:
          "Updated quote for 3-ton Carrier split system. $8,200 installed including 10-year warranty.",
        tags: ["HVAC", "Quote"],
        belongsHere: true,
      },
      {
        id: "e7",
        subject: "Energy audit results",
        sender: "Green Check Inspections",
        date: "4 days ago",
        summary:
          "Audit complete. Recommends minimum 3-ton system. Current ductwork adequate with minor sealing.",
        tags: ["HVAC"],
        belongsHere: true,
      },
      {
        id: "e8",
        subject: "HVAC bid - AirPro Services",
        sender: "Tom Miller, AirPro",
        date: "1 week ago",
        summary: "Bid for 2.5-ton Lennox system. $7,400 installed. 5-year parts warranty.",
        tags: ["HVAC", "Quote"],
        belongsHere: true,
      },
    ],
  },
  {
    id: "c3",
    title: "Insurance Renewal 2026",
    entity: "Portfolio",
    secondaryEntity: "State Farm - Jennifer Wells",
    tags: ["Insurance", "Financial"],
    emailCount: 12,
    lastActivity: "3 days ago",
    lastSender: "Jennifer Wells, State Farm",
    status: "active",
    highlight: { label: "Premium", value: "$4,850/yr", format: "currency" },
    summary: {
      beginning:
        "Annual insurance renewal for all properties. Premium increase notification received.",
      middle:
        "Agent provided comparison quotes. Discussed coverage adjustments for Harbor View renovation.",
      end: "Pending decision on deductible changes to offset premium increase.",
    },
    emails: [],
  },
  {
    id: "c4",
    title: "Bathroom Tile Installation",
    entity: "Harbor View Renovation",
    secondaryEntity: "Martinez Tile Co",
    tags: ["Materials", "Bathroom"],
    emailCount: 4,
    lastActivity: "5 days ago",
    lastSender: "Rosa Martinez, Martinez Tile",
    status: "active",
    highlight: { label: "Cost", value: "$3,100", format: "currency" },
    summary: {
      beginning: "Tile selected for master bathroom renovation. Custom order placed.",
      middle: "Partial shipment received. Back-order on accent tiles expected in 2 weeks.",
      end: "Installation scheduled pending full delivery.",
    },
    emails: [],
  },
  {
    id: "c5",
    title: "Roof Inspection Report",
    entity: "Elm Street Rental",
    secondaryEntity: "Peak Roofing",
    tags: ["Roof", "Inspection"],
    emailCount: 3,
    lastActivity: "1 week ago",
    lastSender: "Jim Torres, Peak Roofing",
    status: "resolved",
    highlight: { label: "Cost", value: "$650", format: "currency" },
    summary: {
      beginning: "Annual roof inspection scheduled after tenant reported minor leak.",
      middle: "Inspector found worn flashing around chimney. Repair quote provided.",
      end: "Flashing repaired. No further action needed.",
    },
    emails: [],
  },
];

const MOCK_METRICS = {
  casesViewed: 34,
  corrections: 2,
  thumbsUp: 8,
  thumbsDown: 1,
  accuracy: null, // Will compute
  phase: "calibrating", // calibrating | tracking | stable
  daysActive: 4,
  signalsNeeded: 5, // signals until score appears
  signalsCollected: 11,
};

// --- ICONS (inline SVG) ---
const Icons = {
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
  thumbUp: (
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
      <path d="M7 22V11L2 11V22H7Z" />
      <path d="M7 11L11 2C11.5 2 13 2 14 3C15 4 14.5 6 14 7H20C21 7 22 8 22 9L20 20C20 21 19 22 18 22H7" />
    </svg>
  ),
  thumbDown: (
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
      <path d="M17 2V13H22V2H17Z" />
      <path d="M17 13L13 22C12.5 22 11 22 10 21C9 20 9.5 18 10 17H4C3 17 2 16 2 15L4 4C4 3 5 2 6 2H17" />
    </svg>
  ),
  chevron: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M6 4L10 8L6 12" />
    </svg>
  ),
  mail: (
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
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 4L12 13L2 4" />
    </svg>
  ),
  move: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 9L2 12L5 15" />
      <path d="M19 9L22 12L19 15" />
      <path d="M2 12H22" />
    </svg>
  ),
  flag: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 15V3" />
      <path d="M4 3C4 3 5 2 8 2C11 2 13 4 16 4C19 4 20 3 20 3V15C20 15 19 16 16 16C13 16 11 14 8 14C5 14 4 15 4 15" />
    </svg>
  ),
  settings: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  ),
  pulse: (
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
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  x: (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M18 6L6 18M6 6L18 18" />
    </svg>
  ),
  merge: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 6L12 2L16 6" />
      <path d="M12 2V14" />
      <path d="M6 18H18" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  ),
  split: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 18L12 22L8 18" />
      <path d="M12 22V10" />
      <path d="M6 6H18" />
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="6" r="2" />
    </svg>
  ),
  exclude: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M4.93 4.93L19.07 19.07" />
    </svg>
  ),
  plus: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M12 5V19M5 12H19" />
    </svg>
  ),
  filter: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="4" />
    </svg>
  ),
};

// --- COMPONENTS ---

function Tag({ label, color }) {
  const colors = {
    default: { bg: T.bgAccent, text: T.textSecondary },
    accent: { bg: T.accentSoft, text: T.accentText },
    success: { bg: T.successSoft, text: T.successText },
    warn: { bg: T.warnSoft, text: T.warnText },
  };
  const c = colors[color] || colors.default;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "100px",
        fontSize: "11px",
        fontWeight: 500,
        letterSpacing: "0.01em",
        background: c.bg,
        color: c.text,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function MetricBar({ metrics }) {
  const signals = metrics.signalsCollected;
  const needed = metrics.signalsNeeded;
  const isTracking = signals >= needed;
  const accuracy = isTracking
    ? Math.round(
        (1 - (metrics.corrections + metrics.thumbsDown) / Math.max(metrics.casesViewed, 1)) * 100,
      )
    : null;

  return (
    <div
      style={{
        padding: "10px 16px",
        background: isTracking
          ? accuracy >= 90
            ? T.successSoft
            : accuracy >= 75
              ? T.warnSoft
              : T.errorSoft
          : T.bgAccent,
        borderBottom: `1px solid ${T.border}`,
        display: "flex",
        alignItems: "center",
        gap: "8px",
        fontSize: "12px",
        fontWeight: 500,
      }}
    >
      <span style={{ color: T.textMuted, display: "flex", alignItems: "center", gap: "4px" }}>
        {Icons.pulse}
      </span>
      {isTracking ? (
        <>
          <span
            style={{
              color: accuracy >= 90 ? T.successText : accuracy >= 75 ? T.warnText : T.errorText,
            }}
          >
            {accuracy}% accuracy
          </span>
          <span style={{ color: T.textMuted }}>
            {metrics.corrections} correction{metrics.corrections !== 1 ? "s" : ""} in{" "}
            {metrics.casesViewed} cases
          </span>
        </>
      ) : (
        <>
          <span style={{ color: T.textSecondary }}>Calibrating</span>
          <span style={{ color: T.textMuted }}>
            {signals}/{needed} signals collected
          </span>
          <div
            style={{
              flex: 1,
              height: "3px",
              background: T.border,
              borderRadius: "2px",
              overflow: "hidden",
              maxWidth: "60px",
            }}
          >
            <div
              style={{
                width: `${(signals / needed) * 100}%`,
                height: "100%",
                background: T.accent,
                borderRadius: "2px",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function CaseCard({ caseData, onTap }) {
  return (
    <div
      onClick={() => onTap(caseData)}
      style={{
        background: T.bgCard,
        borderRadius: T.radius,
        padding: "14px 16px",
        cursor: "pointer",
        border: `1px solid ${T.border}`,
        transition: "box-shadow 0.15s ease",
        boxShadow: T.shadow,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.boxShadow = T.shadowLg)}
      onMouseLeave={(e) => (e.currentTarget.style.boxShadow = T.shadow)}
    >
      {/* Line 1: Title */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "4px",
        }}
      >
        <h3
          style={{
            fontSize: "14px",
            fontWeight: 600,
            color: T.text,
            margin: 0,
            lineHeight: 1.3,
            flex: 1,
            paddingRight: "8px",
          }}
        >
          {caseData.title}
        </h3>
        <span style={{ color: T.textMuted, flexShrink: 0, marginTop: "2px" }}>{Icons.chevron}</span>
      </div>

      {/* Line 2: Last sender + time */}
      <div
        style={{
          fontSize: "12px",
          color: T.textSecondary,
          marginBottom: "8px",
          lineHeight: 1.3,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            paddingRight: "8px",
          }}
        >
          {caseData.lastSender}
        </span>
        <span style={{ color: T.textMuted, fontSize: "11px", flexShrink: 0 }}>
          {caseData.lastActivity}
        </span>
      </div>

      {/* Line 3: Current status (labeled) */}
      <div style={{ marginBottom: "10px" }}>
        <span
          style={{
            fontSize: "10px",
            fontWeight: 600,
            color: caseData.status === "resolved" ? T.successText : T.warnText,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            marginRight: "6px",
          }}
        >
          {caseData.status === "resolved" ? "Resolved" : "Status"}:
        </span>
        <span
          style={{
            fontSize: "12px",
            color: T.textSecondary,
            lineHeight: 1.5,
          }}
        >
          {caseData.summary.end || caseData.summary.middle}
        </span>
      </div>

      {/* Footer: tags + email count + highlight */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", alignItems: "center" }}>
          {caseData.tags.slice(0, 2).map((t) => (
            <Tag key={t} label={t} />
          ))}
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "2px",
              color: T.textMuted,
              fontSize: "11px",
            }}
          >
            {Icons.mail} {caseData.emailCount}
          </span>
        </div>
        {caseData.highlight && (
          <div
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: T.text,
              fontFamily: T.fontMono,
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span
              style={{ fontSize: "10px", fontWeight: 500, color: T.textMuted, fontFamily: T.font }}
            >
              {caseData.highlight.label}
            </span>
            {caseData.highlight.value}
          </div>
        )}
      </div>
    </div>
  );
}

function ThumbsDownSheet({ onSelect, onClose }) {
  const options = [
    {
      id: "wrong_group",
      icon: Icons.merge,
      label: "Wrong emails grouped",
      desc: "Emails in here don't belong together",
    },
    {
      id: "missing",
      icon: Icons.split,
      label: "Missing emails",
      desc: "Related emails aren't in this case",
    },
    {
      id: "not_useful",
      icon: Icons.flag,
      label: "Not useful",
      desc: "This case is noise or irrelevant",
    },
  ];

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        top: 0,
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: T.bgOverlay,
          animation: "fadeIn 0.15s ease",
        }}
      />

      {/* Sheet */}
      <div
        style={{
          position: "relative",
          background: T.bgCard,
          borderRadius: "16px 16px 0 0",
          padding: "8px 16px 24px",
          animation: "slideUp 0.2s ease",
        }}
      >
        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 16px" }}>
          <div
            style={{ width: "36px", height: "4px", borderRadius: "2px", background: T.border }}
          />
        </div>

        <p style={{ fontSize: "14px", fontWeight: 600, color: T.text, margin: "0 0 12px 0" }}>
          What's wrong with this case?
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {options.map((opt) => (
            <div
              key={opt.id}
              onClick={() => onSelect(opt.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "12px",
                borderRadius: T.radiusSm,
                border: `1px solid ${T.border}`,
                cursor: "pointer",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = T.bgAccent)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{ color: T.textSecondary, flexShrink: 0 }}>{opt.icon}</div>
              <div>
                <div style={{ fontSize: "13px", fontWeight: 500, color: T.text }}>{opt.label}</div>
                <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "1px" }}>
                  {opt.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
      `}</style>
    </div>
  );
}

function MoveEmailSheet({ email, cases, currentCaseId, onMove, onNewCase, onClose }) {
  const otherCases = cases.filter((c) => c.id !== currentCaseId);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        top: 0,
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
      }}
    >
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: T.bgOverlay,
          animation: "fadeIn 0.15s ease",
        }}
      />

      <div
        style={{
          position: "relative",
          background: T.bgCard,
          borderRadius: "16px 16px 0 0",
          padding: "8px 16px 24px",
          maxHeight: "60vh",
          overflow: "auto",
          animation: "slideUp 0.2s ease",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 12px" }}>
          <div
            style={{ width: "36px", height: "4px", borderRadius: "2px", background: T.border }}
          />
        </div>

        <p style={{ fontSize: "14px", fontWeight: 600, color: T.text, margin: "0 0 4px 0" }}>
          Move this email to...
        </p>
        <p style={{ fontSize: "12px", color: T.textMuted, margin: "0 0 12px 0", lineHeight: 1.4 }}>
          "{email.subject}"
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {otherCases.map((c) => (
            <div
              key={c.id}
              onClick={() => onMove(c.id)}
              style={{
                padding: "10px 12px",
                borderRadius: T.radiusSm,
                border: `1px solid ${T.border}`,
                cursor: "pointer",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = T.bgAccent)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{ fontSize: "13px", fontWeight: 500, color: T.text }}>{c.title}</div>
              <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "2px" }}>
                {c.entity}
              </div>
            </div>
          ))}

          <div
            onClick={onNewCase}
            style={{
              padding: "10px 12px",
              borderRadius: T.radiusSm,
              border: `1px dashed ${T.accent}`,
              cursor: "pointer",
              textAlign: "center",
              fontSize: "13px",
              fontWeight: 500,
              color: T.accent,
              transition: "background 0.1s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = T.accentSoft)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            + Create new case
          </div>
        </div>
      </div>
    </div>
  );
}

function EmailRow({ email, onSwipeAction, isLast }) {
  const [swipeX, setSwipeX] = useState(0);
  const [startX, setStartX] = useState(null);
  const [showActions, setShowActions] = useState(false);
  const threshold = -70;

  const handleTouchStart = (e) => setStartX(e.touches[0].clientX);
  const handleTouchMove = (e) => {
    if (startX === null) return;
    const diff = e.touches[0].clientX - startX;
    if (diff < 0) setSwipeX(Math.max(diff, -120));
  };
  const handleTouchEnd = () => {
    if (swipeX < threshold) {
      setShowActions(true);
      setSwipeX(-120);
    } else {
      setSwipeX(0);
    }
    setStartX(null);
  };

  const resetSwipe = () => {
    setSwipeX(0);
    setShowActions(false);
  };

  return (
    <div style={{ position: "relative", overflow: "hidden" }}>
      {/* Action buttons revealed on swipe */}
      <div
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: "120px",
          display: "flex",
          alignItems: "stretch",
        }}
      >
        <div
          onClick={() => {
            resetSwipe();
            onSwipeAction("move", email);
          }}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: T.accent,
            color: T.textInverse,
            fontSize: "10px",
            fontWeight: 500,
            gap: "4px",
            cursor: "pointer",
          }}
        >
          {Icons.move}
          Move
        </div>
        <div
          onClick={() => {
            resetSwipe();
            onSwipeAction("exclude", email);
          }}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#8B8B8B",
            color: T.textInverse,
            fontSize: "10px",
            fontWeight: 500,
            gap: "4px",
            cursor: "pointer",
          }}
        >
          {Icons.exclude}
          Exclude
        </div>
      </div>

      {/* Email content - slides left */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => {
          if (showActions) resetSwipe();
        }}
        style={{
          position: "relative",
          background: T.bgCard,
          padding: "12px 0",
          borderBottom: isLast ? "none" : `1px solid ${T.borderLight}`,
          transform: `translateX(${swipeX}px)`,
          transition: startX !== null ? "none" : "transform 0.2s ease",
          zIndex: 1,
          cursor: "default",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: "4px",
          }}
        >
          <span
            style={{
              fontSize: "12px",
              fontWeight: 500,
              color: T.text,
              flex: 1,
              paddingRight: "8px",
              lineHeight: 1.3,
            }}
          >
            {email.sender}
          </span>
          <span style={{ fontSize: "11px", color: T.textMuted, flexShrink: 0 }}>{email.date}</span>
        </div>
        <div
          style={{ fontSize: "12px", color: T.textSecondary, marginBottom: "4px", lineHeight: 1.3 }}
        >
          {email.subject}
        </div>
        <div
          style={{
            fontSize: "11px",
            color: T.textMuted,
            lineHeight: 1.4,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {email.summary}
        </div>
        {!email.belongsHere && (
          <div
            style={{
              marginTop: "6px",
              fontSize: "10px",
              fontWeight: 500,
              color: T.warnText,
              background: T.warnSoft,
              padding: "2px 8px",
              borderRadius: "100px",
              display: "inline-block",
            }}
          >
            Might belong in: {email.betterCase}
          </div>
        )}

        {/* Mouse-friendly action hint */}
        <div
          style={{
            position: "absolute",
            right: "0",
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            gap: "4px",
            opacity: 0,
            transition: "opacity 0.15s",
            pointerEvents: "none",
          }}
          className="email-actions"
        >
          <span
            style={{
              padding: "4px",
              borderRadius: "4px",
              background: T.bgAccent,
              color: T.textMuted,
              cursor: "pointer",
              display: "flex",
            }}
            onClick={(e) => {
              e.stopPropagation();
              onSwipeAction("move", email);
            }}
          >
            {Icons.move}
          </span>
        </div>
      </div>
    </div>
  );
}

function CaseDetail({ caseData, allCases, onBack, onThumbsUp, onThumbsDown }) {
  const [showThumbsDownSheet, setShowThumbsDownSheet] = useState(false);
  const [showMoveSheet, setShowMoveSheet] = useState(null); // email object
  const [voted, setVoted] = useState(null); // 'up' | 'down' | null
  const [toast, setToast] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const handleThumbsUp = () => {
    setVoted("up");
    onThumbsUp(caseData.id);
    showToast("Marked as good case");
  };

  const handleThumbsDown = () => {
    setShowThumbsDownSheet(true);
  };

  const handleThumbsDownSelect = (reason) => {
    setShowThumbsDownSheet(false);
    setVoted("down");
    onThumbsDown(caseData.id, reason);
    const labels = {
      wrong_group: "Wrong grouping reported",
      missing: "Missing emails reported",
      not_useful: "Marked as not useful",
    };
    showToast(labels[reason]);
  };

  const handleSwipeAction = (action, email) => {
    if (action === "move") setShowMoveSheet(email);
    if (action === "exclude") {
      showToast("Excluded from future scans");
    }
  };

  const handleMoveEmail = (targetCaseId) => {
    setShowMoveSheet(null);
    const targetCase = allCases.find((c) => c.id === targetCaseId);
    showToast(`Moved to "${targetCase?.title}"`);
  };

  const s = caseData.summary;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: T.bg }}>
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          background: T.bgCard,
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}
      >
        <div
          onClick={onBack}
          style={{ cursor: "pointer", color: T.textSecondary, display: "flex" }}
        >
          {Icons.back}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2
            style={{
              fontSize: "15px",
              fontWeight: 600,
              color: T.text,
              margin: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {caseData.title}
          </h2>
          <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "1px" }}>
            {caseData.entity} / {caseData.secondaryEntity}
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflow: "auto", padding: "0" }}>
        {/* Case Summary - Beginning / Middle / End */}
        <div
          style={{ padding: "16px", background: T.bgCard, borderBottom: `1px solid ${T.border}` }}
        >
          <div style={{ display: "flex", gap: "4px", marginBottom: "12px", flexWrap: "wrap" }}>
            {caseData.tags.map((t) => (
              <Tag key={t} label={t} color="accent" />
            ))}
            <Tag label={`${caseData.emailCount} emails`} />
            <Tag
              label={caseData.status === "resolved" ? "Resolved" : "Active"}
              color={caseData.status === "resolved" ? "success" : "warn"}
            />
          </div>

          {/* Beginning / Middle / End summary sections */}
          {[
            { label: "Issue", content: s.beginning, dot: T.accent },
            { label: "Activity", content: s.middle, dot: T.warn },
            { label: "Current Status", content: s.end, dot: T.success },
          ].map(({ label, content, dot }) => (
            <div key={label} style={{ marginBottom: "10px", display: "flex", gap: "10px" }}>
              <div
                style={{
                  width: "8px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  paddingTop: "6px",
                }}
              >
                <div
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: dot,
                    flexShrink: 0,
                  }}
                />
                <div style={{ width: "1px", flex: 1, background: T.border, marginTop: "4px" }} />
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: "10px",
                    fontWeight: 600,
                    color: T.textMuted,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: "3px",
                  }}
                >
                  {label}
                </div>
                <div style={{ fontSize: "13px", color: T.text, lineHeight: 1.5 }}>{content}</div>
              </div>
            </div>
          ))}

          {/* Thumbs up/down */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              paddingTop: "8px",
              borderTop: `1px solid ${T.borderLight}`,
              marginTop: "4px",
            }}
          >
            <span style={{ fontSize: "11px", color: T.textMuted, flex: 1 }}>
              Is this case accurate?
            </span>
            <div
              onClick={voted !== "up" ? handleThumbsUp : undefined}
              style={{
                padding: "6px 10px",
                borderRadius: T.radiusXs,
                cursor: voted === "up" ? "default" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "12px",
                fontWeight: 500,
                background: voted === "up" ? T.successSoft : "transparent",
                color: voted === "up" ? T.successText : T.textMuted,
                border: `1px solid ${voted === "up" ? T.successText : T.border}`,
                transition: "all 0.15s",
              }}
            >
              {Icons.thumbUp}
            </div>
            <div
              onClick={voted !== "down" ? handleThumbsDown : undefined}
              style={{
                padding: "6px 10px",
                borderRadius: T.radiusXs,
                cursor: voted === "down" ? "default" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "12px",
                fontWeight: 500,
                background: voted === "down" ? T.errorSoft : "transparent",
                color: voted === "down" ? T.errorText : T.textMuted,
                border: `1px solid ${voted === "down" ? T.errorText : T.border}`,
                transition: "all 0.15s",
              }}
            >
              {Icons.thumbDown}
            </div>
          </div>
        </div>
        {/* Email list */}
        <div style={{ padding: "12px 16px 4px" }}>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: T.textMuted,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: "8px",
            }}
          >
            Emails ({caseData.emails.length})
          </div>
          <div style={{ fontSize: "10px", color: T.textMuted, marginBottom: "10px" }}>
            Swipe left to move or exclude an email
          </div>
        </div>
        <div
          style={{
            padding: "0 16px",
            background: T.bgCard,
            border: `1px solid ${T.border}`,
            borderLeft: "none",
            borderRight: "none",
          }}
        >
          {caseData.emails.map((email, i) => (
            <EmailRow
              key={email.id}
              email={email}
              isLast={i === caseData.emails.length - 1}
              onSwipeAction={handleSwipeAction}
            />
          ))}
          {caseData.emails.length === 0 && (
            <div
              style={{
                padding: "24px 0",
                textAlign: "center",
                fontSize: "13px",
                color: T.textMuted,
              }}
            >
              Tap a case with emails to see the detail view
            </div>
          )}
        </div>
        <div style={{ height: "80px" }} /> {/* Bottom spacer */}
      </div>

      {/* Bottom action bar */}
      <div
        style={{
          padding: "10px 16px",
          background: T.bgCard,
          borderTop: `1px solid ${T.border}`,
          display: "flex",
          gap: "8px",
        }}
      >
        <div
          style={{
            flex: 1,
            padding: "10px",
            borderRadius: T.radiusSm,
            border: `1px solid ${T.border}`,
            textAlign: "center",
            fontSize: "12px",
            fontWeight: 500,
            color: T.textSecondary,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
          }}
        >
          {Icons.merge} Merge with...
        </div>
        <div
          style={{
            flex: 1,
            padding: "10px",
            borderRadius: T.radiusSm,
            border: `1px solid ${T.border}`,
            textAlign: "center",
            fontSize: "12px",
            fontWeight: 500,
            color: T.textSecondary,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
          }}
        >
          {Icons.split} Split case
        </div>
      </div>

      {/* Sheets */}
      {showThumbsDownSheet && (
        <ThumbsDownSheet
          onSelect={handleThumbsDownSelect}
          onClose={() => setShowThumbsDownSheet(false)}
        />
      )}

      {showMoveSheet && (
        <MoveEmailSheet
          email={showMoveSheet}
          cases={allCases}
          currentCaseId={caseData.id}
          onMove={handleMoveEmail}
          onNewCase={() => {
            setShowMoveSheet(null);
            showToast("New case created");
          }}
          onClose={() => setShowMoveSheet(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: "70px",
            left: "50%",
            transform: "translateX(-50%)",
            background: T.text,
            color: T.textInverse,
            padding: "8px 16px",
            borderRadius: "100px",
            fontSize: "12px",
            fontWeight: 500,
            boxShadow: T.shadowLg,
            zIndex: 200,
            animation: "fadeIn 0.15s ease",
            whiteSpace: "nowrap",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

// --- MAIN APP ---
export default function CaseEnginePrototype() {
  const [screen, setScreen] = useState("feed"); // feed | detail | metrics
  const [selectedCase, setSelectedCase] = useState(null);
  const [metrics, setMetrics] = useState(MOCK_METRICS);
  const [eventLog, setEventLog] = useState([]);
  const [filter, setFilter] = useState("all"); // all | active | resolved
  const [scopeFilter, setScopeFilter] = useState(null); // null = show all, string = entity name
  const [showOnboardingToast, setShowOnboardingToast] = useState(false);

  const logEvent = (type, data) => {
    const event = { type, data, timestamp: new Date().toISOString() };
    setEventLog((prev) => [event, ...prev]);
    console.log("[METRIC]", JSON.stringify(event));
  };

  const handleCaseTap = (caseData) => {
    setSelectedCase(caseData);
    setScreen("detail");
    setMetrics((m) => ({
      ...m,
      casesViewed: m.casesViewed + 1,
      signalsCollected: m.signalsCollected + 1,
    }));
    logEvent("case_viewed", { caseId: caseData.id, title: caseData.title });
  };

  const handleThumbsUp = (caseId) => {
    setMetrics((m) => ({
      ...m,
      thumbsUp: m.thumbsUp + 1,
      signalsCollected: m.signalsCollected + 1,
    }));
    logEvent("thumbs_up", { caseId });
  };

  const handleThumbsDown = (caseId, reason) => {
    setMetrics((m) => ({
      ...m,
      thumbsDown: m.thumbsDown + 1,
      signalsCollected: m.signalsCollected + 1,
    }));
    logEvent("thumbs_down", { caseId, reason });
  };

  const filteredCases = MOCK_CASES.filter((c) => {
    if (filter === "active" && c.status !== "active") return false;
    if (filter === "resolved" && c.status !== "resolved") return false;
    if (scopeFilter && c.entity !== scopeFilter) return false;
    return true;
  });

  const allEntities = [...new Set(MOCK_CASES.map((c) => c.entity))];

  const entityGroups = {};
  filteredCases.forEach((c) => {
    if (!entityGroups[c.entity]) entityGroups[c.entity] = [];
    entityGroups[c.entity].push(c);
  });

  if (screen === "detail" && selectedCase) {
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
        <CaseDetail
          caseData={selectedCase}
          allCases={MOCK_CASES}
          onBack={() => setScreen("feed")}
          onThumbsUp={handleThumbsUp}
          onThumbsDown={handleThumbsDown}
        />
      </div>
    );
  }

  if (screen === "metrics") {
    const signals = metrics.signalsCollected;
    const needed = metrics.signalsNeeded;
    const isTracking = signals >= needed;
    const accuracy = isTracking
      ? Math.round(
          (1 - (metrics.corrections + metrics.thumbsDown) / Math.max(metrics.casesViewed, 1)) * 100,
        )
      : null;

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
          display: "flex",
          flexDirection: "column",
        }}
      >
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />

        {/* Header */}
        <div
          style={{
            padding: "12px 16px",
            background: T.bgCard,
            borderBottom: `1px solid ${T.border}`,
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div
            onClick={() => setScreen("feed")}
            style={{ cursor: "pointer", color: T.textSecondary, display: "flex" }}
          >
            {Icons.back}
          </div>
          <h2 style={{ fontSize: "15px", fontWeight: 600, color: T.text, margin: 0 }}>
            Quality Metrics
          </h2>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "16px" }}>
          {/* Big accuracy number */}
          <div
            style={{
              background: T.bgCard,
              borderRadius: T.radius,
              padding: "24px",
              textAlign: "center",
              border: `1px solid ${T.border}`,
              marginBottom: "12px",
            }}
          >
            {isTracking ? (
              <>
                <div
                  style={{
                    fontSize: "48px",
                    fontWeight: 700,
                    color: accuracy >= 90 ? T.success : accuracy >= 75 ? T.warn : T.error,
                    fontFamily: T.fontMono,
                  }}
                >
                  {accuracy}%
                </div>
                <div style={{ fontSize: "13px", color: T.textSecondary, marginTop: "4px" }}>
                  Case accuracy (rolling 30 days)
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: "24px", fontWeight: 600, color: T.textMuted }}>
                  Calibrating...
                </div>
                <div style={{ fontSize: "13px", color: T.textSecondary, marginTop: "8px" }}>
                  {signals} of {needed} signals collected
                </div>
                <div
                  style={{
                    height: "6px",
                    background: T.bgAccent,
                    borderRadius: "3px",
                    overflow: "hidden",
                    marginTop: "12px",
                    maxWidth: "200px",
                    margin: "12px auto 0",
                  }}
                >
                  <div
                    style={{
                      width: `${(signals / needed) * 100}%`,
                      height: "100%",
                      background: T.accent,
                      borderRadius: "3px",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </>
            )}
          </div>

          {/* Stats grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "8px",
              marginBottom: "16px",
            }}
          >
            {[
              { label: "Cases Viewed", value: metrics.casesViewed, color: T.text },
              { label: "Corrections", value: metrics.corrections, color: T.warn },
              { label: "Thumbs Up", value: metrics.thumbsUp, color: T.success },
              { label: "Thumbs Down", value: metrics.thumbsDown, color: T.error },
            ].map((stat) => (
              <div
                key={stat.label}
                style={{
                  background: T.bgCard,
                  borderRadius: T.radiusSm,
                  padding: "12px",
                  border: `1px solid ${T.border}`,
                }}
              >
                <div
                  style={{
                    fontSize: "24px",
                    fontWeight: 700,
                    color: stat.color,
                    fontFamily: T.fontMono,
                  }}
                >
                  {stat.value}
                </div>
                <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "2px" }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>

          {/* Event log */}
          <div
            style={{
              background: T.bgCard,
              borderRadius: T.radius,
              border: `1px solid ${T.border}`,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "10px 12px",
                borderBottom: `1px solid ${T.border}`,
                fontSize: "11px",
                fontWeight: 600,
                color: T.textMuted,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Event Log (last 20)
            </div>
            {eventLog.length === 0 ? (
              <div
                style={{
                  padding: "16px",
                  textAlign: "center",
                  fontSize: "12px",
                  color: T.textMuted,
                }}
              >
                Interact with cases to generate events
              </div>
            ) : (
              eventLog.slice(0, 20).map((evt, i) => (
                <div
                  key={i}
                  style={{
                    padding: "8px 12px",
                    borderBottom:
                      i < Math.min(eventLog.length, 20) - 1 ? `1px solid ${T.borderLight}` : "none",
                    fontSize: "11px",
                    fontFamily: T.fontMono,
                    display: "flex",
                    gap: "8px",
                    alignItems: "baseline",
                  }}
                >
                  <span style={{ color: T.textMuted, flexShrink: 0 }}>
                    {new Date(evt.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                  <span
                    style={{
                      color:
                        evt.type === "thumbs_up"
                          ? T.success
                          : evt.type === "thumbs_down"
                            ? T.error
                            : T.accent,
                      fontWeight: 500,
                      flexShrink: 0,
                    }}
                  >
                    {evt.type}
                  </span>
                  <span
                    style={{
                      color: T.textSecondary,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {JSON.stringify(evt.data)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  // --- FEED SCREEN ---
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
        display: "flex",
        flexDirection: "column",
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />

      {/* Header */}
      <div
        style={{
          padding: "14px 16px 10px",
          background: T.bgCard,
          borderBottom: `1px solid ${T.border}`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "10px",
          }}
        >
          <h1
            style={{
              fontSize: "18px",
              fontWeight: 700,
              color: T.text,
              margin: 0,
              letterSpacing: "-0.02em",
            }}
          >
            Cases
          </h1>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <div
              onClick={() => setScreen("metrics")}
              style={{ cursor: "pointer", color: T.textMuted, display: "flex", padding: "4px" }}
              title="Quality Metrics"
            >
              {Icons.pulse}
            </div>
            <div
              style={{ cursor: "pointer", color: T.textMuted, display: "flex", padding: "4px" }}
              title="Settings"
            >
              {Icons.settings}
            </div>
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ display: "flex", gap: "4px" }}>
          {["all", "active", "resolved"].map((f) => (
            <div
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "5px 12px",
                borderRadius: "100px",
                fontSize: "12px",
                fontWeight: 500,
                cursor: "pointer",
                background: filter === f ? T.text : "transparent",
                color: filter === f ? T.textInverse : T.textMuted,
                transition: "all 0.15s",
                textTransform: "capitalize",
              }}
            >
              {f}
            </div>
          ))}
        </div>
      </div>

      {/* Metric bar */}
      <MetricBar metrics={metrics} />

      {/* Scope filter indicator */}
      {scopeFilter && (
        <div
          style={{
            padding: "8px 16px",
            background: T.accentSoft,
            borderBottom: `1px solid ${T.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "12px",
          }}
        >
          <span style={{ color: T.accentText, fontWeight: 500 }}>Showing: {scopeFilter}</span>
          <span
            onClick={() => setScopeFilter(null)}
            style={{
              color: T.accentText,
              cursor: "pointer",
              fontWeight: 500,
              padding: "2px 8px",
              borderRadius: "100px",
              border: `1px solid ${T.accentText}`,
            }}
          >
            Show all
          </span>
        </div>
      )}

      {/* Case feed */}
      <div style={{ flex: 1, overflow: "auto", padding: "12px 12px" }}>
        {Object.entries(entityGroups).map(([entity, cases]) => (
          <div key={entity} style={{ marginBottom: "16px" }}>
            <div
              onClick={() => setScopeFilter(scopeFilter === entity ? null : entity)}
              style={{
                fontSize: "11px",
                fontWeight: 600,
                color: scopeFilter === entity ? T.accentText : T.textMuted,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                padding: "4px 8px 6px",
                margin: "0 -4px",
                borderRadius: T.radiusXs,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                transition: "all 0.15s",
                background: scopeFilter === entity ? T.accentSoft : "transparent",
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  color: scopeFilter === entity ? T.accent : T.textMuted,
                }}
              >
                {Icons.filter}
              </span>
              {entity}
              <span style={{ color: T.textMuted, fontWeight: 400, fontSize: "10px" }}>
                ({cases.length})
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {cases.map((c) => (
                <CaseCard key={c.id} caseData={c} onTap={handleCaseTap} />
              ))}
            </div>
          </div>
        ))}

        {/* Organize something new button */}
        <div
          onClick={() => {
            setShowOnboardingToast(true);
            setTimeout(() => setShowOnboardingToast(false), 2500);
          }}
          style={{
            margin: "8px 0 24px",
            padding: "14px",
            borderRadius: T.radius,
            border: `1.5px dashed ${T.border}`,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            transition: "all 0.15s",
            background: "transparent",
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
          <span style={{ color: T.accent, display: "flex" }}>{Icons.plus}</span>
          <span style={{ fontSize: "13px", fontWeight: 500, color: T.accent }}>
            Organize something new
          </span>
        </div>
      </div>

      {/* Onboarding toast */}
      {showOnboardingToast && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            left: "50%",
            transform: "translateX(-50%)",
            background: T.text,
            color: T.textInverse,
            padding: "10px 16px",
            borderRadius: "100px",
            fontSize: "12px",
            fontWeight: 500,
            boxShadow: T.shadowLg,
            zIndex: 200,
            animation: "fadeIn 0.15s ease",
            whiteSpace: "nowrap",
          }}
        >
          Opens interview flow (not yet built)
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  );
}
