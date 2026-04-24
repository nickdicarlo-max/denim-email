import { useState, useEffect, useRef } from "react";

// --- DESIGN TOKENS ---
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
  errorText: "#B91C1C",
  radius: "12px",
  radiusSm: "8px",
  radiusXs: "6px",
  shadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
  shadowLg: "0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)",
  font: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  fontMono: "'JetBrains Mono', 'SF Mono', monospace",
};

// --- MOCK DATA: TOPICS (formerly "workspaces") ---
const MOCK_TOPICS = [
  { id: "t1", name: "Harbor View Renovation", emoji: "🏠", caseCount: 3 },
  { id: "t2", name: "Elm Street Rental", emoji: "🏘", caseCount: 1 },
  { id: "t3", name: "Insurance & Portfolio", emoji: "📋", caseCount: 1 },
];

const MOCK_CASES = [
  {
    id: "c1",
    topicId: "t1",
    title: "Kitchen Remodel Permits",
    entity: "City Planning Dept",
    tags: ["Permits", "Timeline"],
    emailCount: 8,
    lastActivity: "2h ago",
    status: "active",
    summary: {
      beginning: "Permit application submitted for kitchen expansion including structural wall removal and new electrical panel.",
      middle: "Two rounds of revision requested by city planning. Structural engineer provided updated calculations. Electrical sub-panel approved.",
      end: "Final permit approved pending inspection scheduling.",
    },
    emails: [
      { id: "e1", subject: "RE: Kitchen permit application #2024-1847", sender: "Mike Chen, City Planning", senderDomain: "cityplanning.gov", date: "2h ago", summary: "Final approval granted. Schedule inspection within 30 days.", tags: ["Permits"], belongsHere: true },
      { id: "e2", subject: "Updated structural calculations", sender: "Sarah Torres, Torres Engineering", senderDomain: "torreseng.com", date: "3 days ago", summary: "Revised beam load calculations per city comments. PSI rating increased to meet code.", tags: ["Permits", "Structural"], belongsHere: true },
      { id: "e3", subject: "RE: Kitchen permit revisions needed", sender: "Mike Chen, City Planning", senderDomain: "cityplanning.gov", date: "1 week ago", summary: "Second revision request. Need updated electrical load calculations for sub-panel.", tags: ["Permits"], belongsHere: true },
      { id: "e4", subject: "Granite countertop samples", sender: "Lisa Park, Stone Masters", senderDomain: "stonemasters.com", date: "1 week ago", summary: "Three granite samples shipped. Brazilian Blue, Kashmir White, and Absolute Black. Pricing attached.", tags: ["Materials"], belongsHere: false, betterCase: "Kitchen Materials & Finishes" },
      { id: "e5", subject: "RE: Permit application submitted", sender: "Mike Chen, City Planning", senderDomain: "cityplanning.gov", date: "2 weeks ago", summary: "Initial review complete. Revision needed for structural wall removal details.", tags: ["Permits"], belongsHere: true },
    ],
  },
  {
    id: "c2",
    topicId: "t1",
    title: "HVAC System Replacement",
    entity: "Comfort Air Solutions",
    tags: ["HVAC", "Quote"],
    emailCount: 5,
    lastActivity: "1 day ago",
    status: "active",
    summary: {
      beginning: "Existing HVAC system failing. Multiple quotes requested for full replacement.",
      middle: "Three bids received. Comfort Air recommended 3-ton split system. Energy audit completed.",
      end: "Awaiting final decision on bid selection.",
    },
    emails: [
      { id: "e6", subject: "Revised HVAC quote - Option B", sender: "Dan Wright, Comfort Air", senderDomain: "comfortair.com", date: "1 day ago", summary: "Updated quote for 3-ton Carrier split system. $8,200 installed including 10-year warranty.", tags: ["HVAC", "Quote"], belongsHere: true },
      { id: "e7", subject: "Energy audit results", sender: "Green Check Inspections", senderDomain: "greenchk.com", date: "4 days ago", summary: "Audit complete. Recommends minimum 3-ton system. Current ductwork adequate with minor sealing.", tags: ["HVAC"], belongsHere: true },
      { id: "e8", subject: "HVAC bid - AirPro Services", sender: "Tom Miller, AirPro", senderDomain: "airpro.com", date: "1 week ago", summary: "Bid for 2.5-ton Lennox system. $7,400 installed. 5-year parts warranty.", tags: ["HVAC", "Quote"], belongsHere: true },
    ],
  },
  {
    id: "c3",
    topicId: "t3",
    title: "Insurance Renewal 2026",
    entity: "State Farm - Jennifer Wells",
    tags: ["Insurance", "Financial"],
    emailCount: 12,
    lastActivity: "3 days ago",
    status: "active",
    summary: {
      beginning: "Annual insurance renewal for all properties. Premium increase notification received.",
      middle: "Agent provided comparison quotes. Discussed coverage adjustments for Harbor View renovation.",
      end: "Pending decision on deductible changes to offset premium increase.",
    },
    emails: [],
  },
  {
    id: "c4",
    topicId: "t1",
    title: "Bathroom Tile Installation",
    entity: "Martinez Tile Co",
    tags: ["Materials", "Bathroom"],
    emailCount: 4,
    lastActivity: "5 days ago",
    status: "active",
    summary: {
      beginning: "Tile selected for master bathroom renovation. Custom order placed.",
      middle: "Partial shipment received. Back-order on accent tiles expected in 2 weeks.",
      end: "Installation scheduled pending full delivery.",
    },
    emails: [],
  },
  {
    id: "c5",
    topicId: "t2",
    title: "Roof Inspection Report",
    entity: "Peak Roofing",
    tags: ["Roof", "Inspection"],
    emailCount: 3,
    lastActivity: "1 week ago",
    status: "resolved",
    summary: {
      beginning: "Annual roof inspection scheduled after tenant reported minor leak.",
      middle: "Inspector found worn flashing around chimney. Repair quote provided.",
      end: "Flashing repaired. No further action needed.",
    },
    emails: [],
  },
];

const MOCK_METRICS = {
  casesViewed: 0,
  corrections: 0,
  thumbsUp: 0,
  thumbsDown: 0,
  emailMoves: 0,
  emailExcludes: 0,
  daysActive: 1,
  signalsNeeded: 10,
  signalsCollected: 0,
};

// --- ICONS ---
const Icons = {
  back: <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 4L6 10L12 16" /></svg>,
  thumbUp: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 22V11L2 11V22H7Z" /><path d="M7 11L11 2C11.5 2 13 2 14 3C15 4 14.5 6 14 7H20C21 7 22 8 22 9L20 20C20 21 19 22 18 22H7" /></svg>,
  thumbDown: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 2V13H22V2H17Z" /><path d="M17 13L13 22C12.5 22 11 22 10 21C9 20 9.5 18 10 17H4C3 17 2 16 2 15L4 4C4 3 5 2 6 2H17" /></svg>,
  chevron: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 4L10 8L6 12" /></svg>,
  mail: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 4L12 13L2 4" /></svg>,
  move: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 9L2 12L5 15" /><path d="M19 9L22 12L19 15" /><path d="M2 12H22" /></svg>,
  exclude: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M4.93 4.93L19.07 19.07" /></svg>,
  settings: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>,
  pulse: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>,
  merge: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6L12 2L16 6" /><path d="M12 2V14" /><path d="M6 18H18" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></svg>,
  split: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 18L12 22L8 18" /><path d="M12 22V10" /><path d="M6 6H18" /><circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /></svg>,
  plus: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5V19M5 12H19" /></svg>,
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
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: "100px",
      fontSize: "11px", fontWeight: 500, letterSpacing: "0.01em",
      background: c.bg, color: c.text, whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

function MetricBar({ metrics, onTap }) {
  const signals = metrics.signalsCollected;
  const needed = metrics.signalsNeeded;
  const isTracking = signals >= needed;
  const total = metrics.casesViewed || 1;
  const negatives = metrics.corrections + metrics.thumbsDown + metrics.emailMoves;
  const accuracy = isTracking ? Math.round((1 - negatives / total) * 100) : null;

  return (
    <div
      onClick={onTap}
      style={{
        padding: "10px 16px",
        background: !isTracking ? T.bgAccent : accuracy >= 90 ? T.successSoft : accuracy >= 75 ? T.warnSoft : T.errorSoft,
        borderBottom: `1px solid ${T.border}`,
        display: "flex", alignItems: "center", gap: "8px",
        fontSize: "12px", fontWeight: 500, cursor: "pointer",
      }}
    >
      <span style={{ color: T.textMuted, display: "flex", alignItems: "center", gap: "4px" }}>
        {Icons.pulse}
      </span>
      {isTracking ? (
        <>
          <span style={{ color: accuracy >= 90 ? T.successText : accuracy >= 75 ? T.warnText : T.errorText }}>
            {accuracy}% accuracy
          </span>
          <span style={{ color: T.textMuted }}>
            {negatives} correction{negatives !== 1 ? "s" : ""} / {metrics.casesViewed} viewed
          </span>
        </>
      ) : (
        <>
          <span style={{ color: T.textSecondary }}>Calibrating</span>
          <span style={{ color: T.textMuted }}>{signals}/{needed} signals</span>
          <div style={{ flex: 1, height: "3px", background: T.border, borderRadius: "2px", overflow: "hidden", maxWidth: "60px" }}>
            <div style={{ width: `${(signals / needed) * 100}%`, height: "100%", background: T.accent, borderRadius: "2px", transition: "width 0.3s ease" }} />
          </div>
        </>
      )}
      <span style={{ color: T.textMuted, marginLeft: "auto" }}>{Icons.chevron}</span>
    </div>
  );
}

function TopicPills({ topics, activeTopic, onSelect, onAdd }) {
  return (
    <div style={{
      display: "flex", gap: "6px", padding: "0 16px 10px",
      overflowX: "auto", WebkitOverflowScrolling: "touch",
      msOverflowStyle: "none", scrollbarWidth: "none",
    }}>
      <div
        onClick={() => onSelect(null)}
        style={{
          padding: "5px 12px", borderRadius: "100px", fontSize: "12px", fontWeight: 500,
          cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
          background: activeTopic === null ? T.text : "transparent",
          color: activeTopic === null ? T.textInverse : T.textMuted,
          transition: "all 0.15s",
        }}
      >
        All
      </div>
      {topics.map(t => (
        <div
          key={t.id}
          onClick={() => onSelect(t.id)}
          style={{
            padding: "5px 12px", borderRadius: "100px", fontSize: "12px", fontWeight: 500,
            cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
            background: activeTopic === t.id ? T.text : "transparent",
            color: activeTopic === t.id ? T.textInverse : T.textMuted,
            transition: "all 0.15s",
          }}
        >
          {t.emoji} {t.name}
        </div>
      ))}
      <div
        onClick={onAdd}
        style={{
          padding: "5px 10px", borderRadius: "100px", fontSize: "12px", fontWeight: 500,
          cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
          color: T.accent, display: "flex", alignItems: "center", gap: "3px",
          border: `1px dashed ${T.accent}`,
          transition: "all 0.15s",
        }}
      >
        {Icons.plus} Add topic
      </div>
    </div>
  );
}

function CaseCard({ caseData, onTap }) {
  return (
    <div
      onClick={() => onTap(caseData)}
      style={{
        background: T.bgCard, borderRadius: T.radius, padding: "14px 16px",
        cursor: "pointer", border: `1px solid ${T.border}`,
        transition: "box-shadow 0.15s ease", boxShadow: T.shadow,
      }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = T.shadowLg}
      onMouseLeave={e => e.currentTarget.style.boxShadow = T.shadow}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
        <h3 style={{ fontSize: "14px", fontWeight: 600, color: T.text, margin: 0, lineHeight: 1.3, flex: 1, paddingRight: "8px" }}>
          {caseData.title}
        </h3>
        <span style={{ color: T.textMuted, flexShrink: 0, marginTop: "2px" }}>{Icons.chevron}</span>
      </div>

      {caseData.entity && (
        <div style={{ fontSize: "12px", color: T.textSecondary, marginBottom: "8px", lineHeight: 1.4 }}>
          <span style={{ fontWeight: 500 }}>{caseData.entity}</span>
        </div>
      )}

      <p style={{
        fontSize: "12px", color: T.textMuted, margin: "0 0 10px 0", lineHeight: 1.5,
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
      }}>
        {caseData.summary.end || caseData.summary.middle}
      </p>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
          {caseData.tags.slice(0, 3).map(t => <Tag key={t} label={t} />)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px", color: T.textMuted, fontSize: "11px", flexShrink: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: "2px" }}>{Icons.mail} {caseData.emailCount}</span>
          <span style={{ margin: "0 2px" }}>·</span>
          <span>{caseData.lastActivity}</span>
        </div>
      </div>
    </div>
  );
}

// --- BOTTOM SHEETS ---

function ThumbsDownSheet({ onSelect, onClose }) {
  const options = [
    { id: "wrong_group", icon: Icons.merge, label: "Wrong emails grouped", desc: "Emails in here don't belong together" },
    { id: "missing", icon: Icons.split, label: "Missing emails", desc: "Related emails aren't in this case" },
    { id: "not_useful", icon: Icons.exclude, label: "Not useful", desc: "This case is noise or irrelevant" },
  ];
  return (
    <Sheet onClose={onClose} title="What's wrong with this case?">
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {options.map(opt => (
          <SheetRow key={opt.id} icon={opt.icon} label={opt.label} desc={opt.desc} onClick={() => onSelect(opt.id)} />
        ))}
      </div>
    </Sheet>
  );
}

function MoveEmailSheet({ email, cases, currentCaseId, onMove, onNewCase, onClose }) {
  const otherCases = cases.filter(c => c.id !== currentCaseId);
  return (
    <Sheet onClose={onClose} title="Move this email to..." subtitle={`"${email.subject}"`}>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {otherCases.map(c => (
          <div key={c.id} onClick={() => onMove(c.id)} style={{
            padding: "10px 12px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`,
            cursor: "pointer", transition: "background 0.1s",
          }}
            onMouseEnter={e => e.currentTarget.style.background = T.bgAccent}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            <div style={{ fontSize: "13px", fontWeight: 500, color: T.text }}>{c.title}</div>
            <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "2px" }}>
              {MOCK_TOPICS.find(t => t.id === c.topicId)?.name}
            </div>
          </div>
        ))}
        <div onClick={onNewCase} style={{
          padding: "10px 12px", borderRadius: T.radiusSm, border: `1px dashed ${T.accent}`,
          cursor: "pointer", textAlign: "center", fontSize: "13px", fontWeight: 500, color: T.accent,
          transition: "background 0.1s",
        }}
          onMouseEnter={e => e.currentTarget.style.background = T.accentSoft}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
        >
          + Create new case
        </div>
      </div>
    </Sheet>
  );
}

function ExcludeSheet({ email, onExclude, onClose }) {
  return (
    <Sheet onClose={onClose} title="Exclude from scans" subtitle={`"${email.subject}"`}>
      <div style={{ fontSize: "13px", color: T.textSecondary, lineHeight: 1.5, marginBottom: "12px" }}>
        This email will be removed from this case. How should we handle similar emails in the future?
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <SheetRow
          icon={Icons.exclude}
          label={`Exclude emails from ${email.senderDomain}`}
          desc="Future emails from this domain will be skipped"
          onClick={() => onExclude("domain", email.senderDomain)}
        />
        <SheetRow
          icon={Icons.mail}
          label="Exclude just this email"
          desc="Only this specific email will be removed"
          onClick={() => onExclude("single", email.id)}
        />
      </div>
    </Sheet>
  );
}

function OnboardingSheet({ onClose }) {
  const [step, setStep] = useState(0);
  const [desc, setDesc] = useState("");

  if (step === 0) {
    return (
      <Sheet onClose={onClose} title="Add a new topic" large>
        <div style={{ fontSize: "13px", color: T.textSecondary, lineHeight: 1.5, marginBottom: "16px" }}>
          Describe what you're trying to organize. Tell us about yourself and what matters to you.
        </div>
        <textarea
          value={desc}
          onChange={e => setDesc(e.target.value)}
          placeholder="e.g. I'm renovating my kitchen and coordinating with contractors, the city permit office, and my interior designer..."
          style={{
            width: "100%", minHeight: "100px", padding: "12px", borderRadius: T.radiusSm,
            border: `1px solid ${T.border}`, fontSize: "14px", fontFamily: T.font,
            color: T.text, background: T.bgAccent, resize: "vertical",
            outline: "none", boxSizing: "border-box",
            lineHeight: 1.5,
          }}
        />
        <div style={{ marginTop: "8px", fontSize: "11px", color: T.textMuted, lineHeight: 1.4 }}>
          The more you share, the better we can organize your email. Include who you work with and what kinds of things you're tracking.
        </div>
        <button
          onClick={() => { if (desc.trim()) setStep(1); }}
          disabled={!desc.trim()}
          style={{
            marginTop: "16px", width: "100%", padding: "12px",
            borderRadius: T.radiusSm, border: "none",
            background: desc.trim() ? T.accent : T.bgAccent,
            color: desc.trim() ? T.textInverse : T.textMuted,
            fontSize: "14px", fontWeight: 600, fontFamily: T.font,
            cursor: desc.trim() ? "pointer" : "default",
            transition: "all 0.15s",
          }}
        >
          Connect Gmail & start scanning
        </button>
      </Sheet>
    );
  }

  if (step === 1) {
    return (
      <Sheet onClose={onClose} title="Analyzing your email..." large>
        <div style={{ textAlign: "center", padding: "32px 0" }}>
          <div style={{
            width: "48px", height: "48px", borderRadius: "50%",
            border: `3px solid ${T.bgAccent}`, borderTopColor: T.accent,
            animation: "spin 0.8s linear infinite", margin: "0 auto 16px",
          }} />
          <div style={{ fontSize: "14px", color: T.text, fontWeight: 500, marginBottom: "4px" }}>
            Scanning recent emails...
          </div>
          <div style={{ fontSize: "12px", color: T.textMuted }}>
            Testing your topic hypothesis against 147 emails
          </div>

          <div style={{ marginTop: "24px", textAlign: "left" }}>
            {[
              { label: "Senders identified", value: "23 domains", done: true },
              { label: "Entities detected", value: "4 contacts", done: true },
              { label: "Categories matched", value: "6 tags", done: false },
              { label: "Building cases", value: "...", done: false },
            ].map((item, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: "8px",
                padding: "6px 0", opacity: item.done ? 1 : 0.5,
              }}>
                <div style={{
                  width: "6px", height: "6px", borderRadius: "50%",
                  background: item.done ? T.success : T.border,
                }} />
                <span style={{ fontSize: "12px", color: T.textSecondary, flex: 1 }}>{item.label}</span>
                <span style={{ fontSize: "12px", color: T.textMuted, fontFamily: T.fontMono }}>{item.value}</span>
              </div>
            ))}
          </div>

          <button
            onClick={() => setStep(2)}
            style={{
              marginTop: "20px", padding: "10px 24px",
              borderRadius: T.radiusSm, border: "none",
              background: T.accent, color: T.textInverse,
              fontSize: "13px", fontWeight: 600, fontFamily: T.font, cursor: "pointer",
            }}
          >
            See what I found
          </button>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </Sheet>
    );
  }

  if (step === 2) {
    return (
      <Sheet onClose={onClose} title="Here's what I set up" large>
        <div style={{ fontSize: "13px", color: T.textSecondary, lineHeight: 1.5, marginBottom: "16px" }}>
          Based on your description and your recent email, I created a topic with these settings. Tap to adjust anything.
        </div>

        {/* Entities */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "11px", fontWeight: 600, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
            People & companies detected
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {["City Planning Dept", "Torres Engineering", "Comfort Air", "Stone Masters", "AirPro Services"].map(e => (
              <span key={e} style={{
                padding: "6px 10px", borderRadius: "100px", fontSize: "12px", fontWeight: 500,
                background: T.accentSoft, color: T.accentText, cursor: "pointer",
              }}>
                {e}
              </span>
            ))}
          </div>
        </div>

        {/* Tags */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "11px", fontWeight: 600, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
            Categories
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {[
              { tag: "Permits", count: 12, strong: true },
              { tag: "HVAC", count: 8, strong: true },
              { tag: "Materials", count: 6, strong: true },
              { tag: "Quotes", count: 5, strong: false },
              { tag: "Structural", count: 3, strong: false },
              { tag: "Timeline", count: 2, strong: false },
            ].map(t => (
              <span key={t.tag} style={{
                padding: "6px 10px", borderRadius: "100px", fontSize: "12px", fontWeight: 500,
                background: t.strong ? T.successSoft : T.bgAccent,
                color: t.strong ? T.successText : T.textSecondary,
                cursor: "pointer",
              }}>
                {t.tag} <span style={{ opacity: 0.6, fontSize: "10px" }}>{t.count}</span>
              </span>
            ))}
          </div>
          <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "6px" }}>
            Green = strong match with your email. Tap any to rename or remove.
          </div>
        </div>

        {/* Internal domains */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "11px", fontWeight: 600, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
            Your team (internal)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {["gmail.com (you)", "north40partners.com"].map(d => (
              <span key={d} style={{
                padding: "6px 10px", borderRadius: "100px", fontSize: "12px", fontWeight: 500,
                background: T.warnSoft, color: T.warnText, cursor: "pointer",
              }}>
                {d}
              </span>
            ))}
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            marginTop: "8px", width: "100%", padding: "12px",
            borderRadius: T.radiusSm, border: "none",
            background: T.accent, color: T.textInverse,
            fontSize: "14px", fontWeight: 600, fontFamily: T.font, cursor: "pointer",
          }}
        >
          Looks good, create my cases
        </button>
      </Sheet>
    );
  }

  return null;
}

// --- SHARED SHEET COMPONENTS ---

function Sheet({ children, onClose, title, subtitle, large }) {
  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0, top: 0, zIndex: 100,
      display: "flex", flexDirection: "column", justifyContent: "flex-end",
    }}>
      <div onClick={onClose} style={{
        position: "absolute", inset: 0, background: T.bgOverlay, animation: "fadeIn 0.15s ease",
      }} />
      <div style={{
        position: "relative", background: T.bgCard, borderRadius: "16px 16px 0 0",
        padding: "8px 16px 24px", maxHeight: large ? "85vh" : "60vh", overflow: "auto",
        animation: "slideUp 0.2s ease",
      }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 12px" }}>
          <div style={{ width: "36px", height: "4px", borderRadius: "2px", background: T.border }} />
        </div>
        {title && <p style={{ fontSize: "14px", fontWeight: 600, color: T.text, margin: "0 0 4px 0" }}>{title}</p>}
        {subtitle && <p style={{ fontSize: "12px", color: T.textMuted, margin: "0 0 12px 0", lineHeight: 1.4 }}>{subtitle}</p>}
        {!subtitle && title && <div style={{ marginBottom: "12px" }} />}
        {children}
      </div>
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
      `}</style>
    </div>
  );
}

function SheetRow({ icon, label, desc, onClick }) {
  return (
    <div onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: "12px", padding: "12px",
      borderRadius: T.radiusSm, border: `1px solid ${T.border}`, cursor: "pointer",
      transition: "background 0.1s",
    }}
      onMouseEnter={e => e.currentTarget.style.background = T.bgAccent}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
    >
      <div style={{ color: T.textSecondary, flexShrink: 0 }}>{icon}</div>
      <div>
        <div style={{ fontSize: "13px", fontWeight: 500, color: T.text }}>{label}</div>
        {desc && <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "1px" }}>{desc}</div>}
      </div>
    </div>
  );
}

// --- EMAIL ROW ---

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
    if (swipeX < threshold) { setShowActions(true); setSwipeX(-120); }
    else { setSwipeX(0); }
    setStartX(null);
  };
  const resetSwipe = () => { setSwipeX(0); setShowActions(false); };

  return (
    <div style={{ position: "relative", overflow: "hidden" }}>
      {/* Swipe-revealed actions */}
      <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "120px", display: "flex" }}>
        <div onClick={() => { resetSwipe(); onSwipeAction("move", email); }} style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          background: T.accent, color: T.textInverse, fontSize: "10px", fontWeight: 500, gap: "4px", cursor: "pointer",
        }}>
          {Icons.move}
          Move
        </div>
        <div onClick={() => { resetSwipe(); onSwipeAction("exclude", email); }} style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          background: T.textSecondary, color: T.textInverse, fontSize: "10px", fontWeight: 500, gap: "4px", cursor: "pointer",
        }}>
          {Icons.exclude}
          Exclude
        </div>
      </div>

      {/* Email content */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => { if (showActions) resetSwipe(); }}
        style={{
          position: "relative", background: T.bgCard, padding: "12px 0",
          borderBottom: isLast ? "none" : `1px solid ${T.borderLight}`,
          transform: `translateX(${swipeX}px)`,
          transition: startX !== null ? "none" : "transform 0.2s ease",
          zIndex: 1,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
          <span style={{ fontSize: "12px", fontWeight: 500, color: T.text, flex: 1, paddingRight: "8px", lineHeight: 1.3 }}>
            {email.sender}
          </span>
          <span style={{ fontSize: "11px", color: T.textMuted, flexShrink: 0 }}>{email.date}</span>
        </div>
        <div style={{ fontSize: "12px", color: T.textSecondary, marginBottom: "4px", lineHeight: 1.3 }}>
          {email.subject}
        </div>
        <div style={{ fontSize: "11px", color: T.textMuted, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {email.summary}
        </div>
        {!email.belongsHere && (
          <div style={{
            marginTop: "6px", fontSize: "10px", fontWeight: 500,
            color: T.warnText, background: T.warnSoft, padding: "2px 8px",
            borderRadius: "100px", display: "inline-block",
          }}>
            Might belong in: {email.betterCase}
          </div>
        )}
      </div>
    </div>
  );
}

// --- CASE DETAIL ---

function CaseDetail({ caseData, allCases, onBack, onThumbsUp, onThumbsDown, onEmailMove, onEmailExclude }) {
  const [showThumbsDownSheet, setShowThumbsDownSheet] = useState(false);
  const [showMoveSheet, setShowMoveSheet] = useState(null);
  const [showExcludeSheet, setShowExcludeSheet] = useState(null);
  const [voted, setVoted] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2000); };

  const handleThumbsUp = () => {
    setVoted("up");
    onThumbsUp(caseData.id);
    showToast("Marked as good case");
  };

  const handleThumbsDown = () => setShowThumbsDownSheet(true);

  const handleThumbsDownSelect = (reason) => {
    setShowThumbsDownSheet(false);
    setVoted("down");
    onThumbsDown(caseData.id, reason);
    const labels = { wrong_group: "Wrong grouping reported", missing: "Missing emails reported", not_useful: "Marked as not useful" };
    showToast(labels[reason]);
  };

  const handleSwipeAction = (action, email) => {
    if (action === "move") setShowMoveSheet(email);
    if (action === "exclude") setShowExcludeSheet(email);
  };

  const handleMoveEmail = (targetCaseId) => {
    setShowMoveSheet(null);
    const targetCase = allCases.find(c => c.id === targetCaseId);
    onEmailMove(caseData.id, showMoveSheet?.id, targetCaseId);
    showToast(`Moved to "${targetCase?.title}"`);
  };

  const handleExclude = (type, value) => {
    setShowExcludeSheet(null);
    onEmailExclude(showExcludeSheet?.id, type, value);
    showToast(type === "domain" ? `Excluding ${value}` : "Email excluded");
  };

  const s = caseData.summary;
  const topicName = MOCK_TOPICS.find(t => t.id === caseData.topicId)?.name;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: T.bg }}>
      {/* Header */}
      <div style={{
        padding: "12px 16px", background: T.bgCard, borderBottom: `1px solid ${T.border}`,
        display: "flex", alignItems: "center", gap: "12px",
      }}>
        <div onClick={onBack} style={{ cursor: "pointer", color: T.textSecondary, display: "flex" }}>
          {Icons.back}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: "15px", fontWeight: 600, color: T.text, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {caseData.title}
          </h2>
          <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "1px" }}>
            {topicName}{caseData.entity ? ` / ${caseData.entity}` : ""}
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {/* Summary */}
        <div style={{ padding: "16px", background: T.bgCard, borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", gap: "4px", marginBottom: "12px", flexWrap: "wrap" }}>
            {caseData.tags.map(t => <Tag key={t} label={t} color="accent" />)}
            <Tag label={`${caseData.emailCount} emails`} />
            <Tag label={caseData.status === "resolved" ? "Resolved" : "Active"} color={caseData.status === "resolved" ? "success" : "warn"} />
          </div>

          {[
            { label: "Issue", content: s.beginning, dot: T.accent },
            { label: "Activity", content: s.middle, dot: T.warn },
            { label: "Current Status", content: s.end, dot: T.success },
          ].map(({ label, content, dot }) => (
            <div key={label} style={{ marginBottom: "10px", display: "flex", gap: "10px" }}>
              <div style={{ width: "8px", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "6px" }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: dot, flexShrink: 0 }} />
                <div style={{ width: "1px", flex: 1, background: T.border, marginTop: "4px" }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "10px", fontWeight: 600, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "3px" }}>{label}</div>
                <div style={{ fontSize: "13px", color: T.text, lineHeight: 1.5 }}>{content}</div>
              </div>
            </div>
          ))}

          {/* Thumbs */}
          <div style={{
            display: "flex", alignItems: "center", gap: "8px", paddingTop: "8px",
            borderTop: `1px solid ${T.borderLight}`, marginTop: "4px",
          }}>
            <span style={{ fontSize: "11px", color: T.textMuted, flex: 1 }}>Is this case accurate?</span>
            {[
              { dir: "up", icon: Icons.thumbUp, active: T.successSoft, activeColor: T.successText, activeBorder: T.successText, handler: handleThumbsUp },
              { dir: "down", icon: Icons.thumbDown, active: T.errorSoft, activeColor: T.errorText, activeBorder: T.errorText, handler: handleThumbsDown },
            ].map(btn => (
              <div
                key={btn.dir}
                onClick={voted !== btn.dir ? btn.handler : undefined}
                style={{
                  padding: "6px 10px", borderRadius: T.radiusXs,
                  cursor: voted === btn.dir ? "default" : "pointer",
                  display: "flex", alignItems: "center", gap: "4px",
                  fontSize: "12px", fontWeight: 500,
                  background: voted === btn.dir ? btn.active : "transparent",
                  color: voted === btn.dir ? btn.activeColor : T.textMuted,
                  border: `1px solid ${voted === btn.dir ? btn.activeBorder : T.border}`,
                  transition: "all 0.15s",
                }}
              >
                {btn.icon}
              </div>
            ))}
          </div>
        </div>

        {/* Email list */}
        <div style={{ padding: "12px 16px 4px" }}>
          <div style={{ fontSize: "11px", fontWeight: 600, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>
            Emails ({caseData.emails.length})
          </div>
          <div style={{ fontSize: "10px", color: T.textMuted, marginBottom: "10px" }}>
            Swipe left to move or exclude an email
          </div>
        </div>

        <div style={{ padding: "0 16px", background: T.bgCard, borderTop: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}` }}>
          {caseData.emails.map((email, i) => (
            <EmailRow key={email.id} email={email} isLast={i === caseData.emails.length - 1} onSwipeAction={handleSwipeAction} />
          ))}
          {caseData.emails.length === 0 && (
            <div style={{ padding: "24px 0", textAlign: "center", fontSize: "13px", color: T.textMuted }}>
              Tap a case with emails to see the detail view
            </div>
          )}
        </div>

        <div style={{ height: "80px" }} />
      </div>

      {/* Bottom actions */}
      <div style={{ padding: "10px 16px", background: T.bgCard, borderTop: `1px solid ${T.border}`, display: "flex", gap: "8px" }}>
        {[
          { icon: Icons.merge, label: "Merge with..." },
          { icon: Icons.split, label: "Split case" },
        ].map(btn => (
          <div key={btn.label} style={{
            flex: 1, padding: "10px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`,
            textAlign: "center", fontSize: "12px", fontWeight: 500, color: T.textSecondary,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
          }}>
            {btn.icon} {btn.label}
          </div>
        ))}
      </div>

      {/* Sheets */}
      {showThumbsDownSheet && <ThumbsDownSheet onSelect={handleThumbsDownSelect} onClose={() => setShowThumbsDownSheet(false)} />}
      {showMoveSheet && <MoveEmailSheet email={showMoveSheet} cases={allCases} currentCaseId={caseData.id} onMove={handleMoveEmail} onNewCase={() => { setShowMoveSheet(null); showToast("New case created"); }} onClose={() => setShowMoveSheet(null)} />}
      {showExcludeSheet && <ExcludeSheet email={showExcludeSheet} onExclude={handleExclude} onClose={() => setShowExcludeSheet(null)} />}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: "70px", left: "50%", transform: "translateX(-50%)",
          background: T.text, color: T.textInverse, padding: "8px 16px", borderRadius: "100px",
          fontSize: "12px", fontWeight: 500, boxShadow: T.shadowLg, zIndex: 200,
          animation: "fadeIn 0.15s ease", whiteSpace: "nowrap",
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// --- METRICS SCREEN ---

function MetricsScreen({ metrics, eventLog, onBack }) {
  const signals = metrics.signalsCollected;
  const needed = metrics.signalsNeeded;
  const isTracking = signals >= needed;
  const total = metrics.casesViewed || 1;
  const negatives = metrics.corrections + metrics.thumbsDown + metrics.emailMoves;
  const accuracy = isTracking ? Math.round((1 - negatives / total) * 100) : null;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: T.bg }}>
      <div style={{
        padding: "12px 16px", background: T.bgCard, borderBottom: `1px solid ${T.border}`,
        display: "flex", alignItems: "center", gap: "12px",
      }}>
        <div onClick={onBack} style={{ cursor: "pointer", color: T.textSecondary, display: "flex" }}>{Icons.back}</div>
        <h2 style={{ fontSize: "15px", fontWeight: 600, color: T.text, margin: 0 }}>Quality Metrics</h2>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "16px" }}>
        {/* Big number */}
        <div style={{
          background: T.bgCard, borderRadius: T.radius, padding: "24px", textAlign: "center",
          border: `1px solid ${T.border}`, marginBottom: "12px",
        }}>
          {isTracking ? (
            <>
              <div style={{ fontSize: "48px", fontWeight: 700, color: accuracy >= 90 ? T.success : accuracy >= 75 ? T.warn : T.error, fontFamily: T.fontMono }}>{accuracy}%</div>
              <div style={{ fontSize: "13px", color: T.textSecondary, marginTop: "4px" }}>Case accuracy (rolling)</div>
              <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "2px" }}>
                {negatives} negative signal{negatives !== 1 ? "s" : ""} out of {metrics.casesViewed} cases viewed
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: "24px", fontWeight: 600, color: T.textMuted }}>Calibrating...</div>
              <div style={{ fontSize: "13px", color: T.textSecondary, marginTop: "8px" }}>
                {signals} of {needed} signals collected
              </div>
              <div style={{ height: "6px", background: T.bgAccent, borderRadius: "3px", overflow: "hidden", marginTop: "12px", maxWidth: "200px", margin: "12px auto 0" }}>
                <div style={{ width: `${(signals / needed) * 100}%`, height: "100%", background: T.accent, borderRadius: "3px", transition: "width 0.3s ease" }} />
              </div>
            </>
          )}
        </div>

        {/* Signal breakdown */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "16px" }}>
          {[
            { label: "Cases Viewed", value: metrics.casesViewed, color: T.text },
            { label: "Email Moves", value: metrics.emailMoves, color: T.warn },
            { label: "Thumbs Up", value: metrics.thumbsUp, color: T.success },
            { label: "Thumbs Down", value: metrics.thumbsDown, color: T.error },
            { label: "Excludes", value: metrics.emailExcludes, color: T.textSecondary },
            { label: "Day", value: metrics.daysActive, color: T.accent },
          ].map(stat => (
            <div key={stat.label} style={{
              background: T.bgCard, borderRadius: T.radiusSm, padding: "12px",
              border: `1px solid ${T.border}`,
            }}>
              <div style={{ fontSize: "24px", fontWeight: 700, color: stat.color, fontFamily: T.fontMono }}>{stat.value}</div>
              <div style={{ fontSize: "11px", color: T.textMuted, marginTop: "2px" }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Formula explanation */}
        <div style={{
          background: T.bgCard, borderRadius: T.radius, padding: "12px",
          border: `1px solid ${T.border}`, marginBottom: "12px",
        }}>
          <div style={{ fontSize: "11px", fontWeight: 600, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
            How accuracy is calculated
          </div>
          <div style={{ fontSize: "12px", color: T.textSecondary, lineHeight: 1.5 }}>
            <span style={{ fontFamily: T.fontMono, fontSize: "11px", background: T.bgAccent, padding: "2px 6px", borderRadius: "4px" }}>
              1 - (moves + thumbs_down) / cases_viewed
            </span>
            <div style={{ marginTop: "6px" }}>
              Thumbs up and case views are positive signals. Email moves, thumbs down, and case-level corrections count against accuracy. Score appears after {needed} signals.
            </div>
          </div>
        </div>

        {/* Event log */}
        <div style={{
          background: T.bgCard, borderRadius: T.radius, border: `1px solid ${T.border}`, overflow: "hidden",
        }}>
          <div style={{
            padding: "10px 12px", borderBottom: `1px solid ${T.border}`,
            fontSize: "11px", fontWeight: 600, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.05em",
          }}>
            Event Log ({eventLog.length})
          </div>
          {eventLog.length === 0 ? (
            <div style={{ padding: "16px", textAlign: "center", fontSize: "12px", color: T.textMuted }}>
              Interact with cases to generate events
            </div>
          ) : (
            eventLog.slice(0, 30).map((evt, i) => (
              <div key={i} style={{
                padding: "8px 12px",
                borderBottom: i < Math.min(eventLog.length, 30) - 1 ? `1px solid ${T.borderLight}` : "none",
                fontSize: "11px", fontFamily: T.fontMono, display: "flex", gap: "8px", alignItems: "baseline",
              }}>
                <span style={{ color: T.textMuted, flexShrink: 0 }}>
                  {new Date(evt.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span style={{
                  color: evt.type.includes("up") ? T.success : evt.type.includes("down") ? T.error : evt.type.includes("move") ? T.warn : evt.type.includes("exclude") ? T.textSecondary : T.accent,
                  fontWeight: 500, flexShrink: 0,
                }}>
                  {evt.type}
                </span>
                <span style={{ color: T.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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

// --- MAIN APP ---
export default function CaseEnginePrototype() {
  const [screen, setScreen] = useState("feed");
  const [selectedCase, setSelectedCase] = useState(null);
  const [metrics, setMetrics] = useState(MOCK_METRICS);
  const [eventLog, setEventLog] = useState([]);
  const [activeTopic, setActiveTopic] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const logEvent = (type, data) => {
    const event = { type, data, timestamp: new Date().toISOString() };
    setEventLog(prev => [event, ...prev]);
    console.log("[METRIC]", JSON.stringify(event));
  };

  const handleCaseTap = (caseData) => {
    setSelectedCase(caseData);
    setScreen("detail");
    setMetrics(m => ({ ...m, casesViewed: m.casesViewed + 1, signalsCollected: m.signalsCollected + 1 }));
    logEvent("case_viewed", { caseId: caseData.id, title: caseData.title });
  };

  const handleThumbsUp = (caseId) => {
    setMetrics(m => ({ ...m, thumbsUp: m.thumbsUp + 1, signalsCollected: m.signalsCollected + 1 }));
    logEvent("thumbs_up", { caseId });
  };

  const handleThumbsDown = (caseId, reason) => {
    setMetrics(m => ({ ...m, thumbsDown: m.thumbsDown + 1, signalsCollected: m.signalsCollected + 1 }));
    logEvent("thumbs_down", { caseId, reason });
  };

  const handleEmailMove = (fromCaseId, emailId, toCaseId) => {
    setMetrics(m => ({ ...m, emailMoves: m.emailMoves + 1, corrections: m.corrections + 1, signalsCollected: m.signalsCollected + 1 }));
    logEvent("email_move", { fromCaseId, emailId, toCaseId });
  };

  const handleEmailExclude = (emailId, type, value) => {
    setMetrics(m => ({ ...m, emailExcludes: m.emailExcludes + 1, signalsCollected: m.signalsCollected + 1 }));
    logEvent("email_exclude", { emailId, excludeType: type, excludeValue: value });
  };

  const filteredCases = MOCK_CASES.filter(c => {
    if (activeTopic) return c.topicId === activeTopic;
    return true;
  });

  // Group by topic when showing "All"
  const groups = {};
  filteredCases.forEach(c => {
    const topic = MOCK_TOPICS.find(t => t.id === c.topicId);
    const key = topic ? topic.name : "Other";
    if (!groups[key]) groups[key] = [];
    groups[key].push(c);
  });

  const containerStyle = {
    width: "100%", maxWidth: "420px", height: "100vh", margin: "0 auto",
    fontFamily: T.font, overflow: "hidden", background: T.bg, position: "relative",
  };

  const fontLink = <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />;

  if (screen === "detail" && selectedCase) {
    return (
      <div style={containerStyle}>
        {fontLink}
        <CaseDetail
          caseData={selectedCase}
          allCases={MOCK_CASES}
          onBack={() => setScreen("feed")}
          onThumbsUp={handleThumbsUp}
          onThumbsDown={handleThumbsDown}
          onEmailMove={handleEmailMove}
          onEmailExclude={handleEmailExclude}
        />
      </div>
    );
  }

  if (screen === "metrics") {
    return (
      <div style={containerStyle}>
        {fontLink}
        <MetricsScreen metrics={metrics} eventLog={eventLog} onBack={() => setScreen("feed")} />
      </div>
    );
  }

  // --- FEED ---
  return (
    <div style={{ ...containerStyle, display: "flex", flexDirection: "column" }}>
      {fontLink}

      {/* Header */}
      <div style={{ padding: "14px 16px 0", background: T.bgCard, borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
          <h1 style={{ fontSize: "18px", fontWeight: 700, color: T.text, margin: 0, letterSpacing: "-0.02em" }}>Cases</h1>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <div onClick={() => setScreen("metrics")} style={{ cursor: "pointer", color: T.textMuted, display: "flex", padding: "4px" }}>{Icons.pulse}</div>
            <div style={{ cursor: "pointer", color: T.textMuted, display: "flex", padding: "4px" }}>{Icons.settings}</div>
          </div>
        </div>

        {/* Topic pills */}
        <TopicPills
          topics={MOCK_TOPICS}
          activeTopic={activeTopic}
          onSelect={setActiveTopic}
          onAdd={() => setShowOnboarding(true)}
        />
      </div>

      {/* Metric bar */}
      <MetricBar metrics={metrics} onTap={() => setScreen("metrics")} />

      {/* Case feed */}
      <div style={{ flex: 1, overflow: "auto", padding: "12px 12px" }}>
        {activeTopic ? (
          // Single topic: flat list
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {filteredCases.map(c => (
              <CaseCard key={c.id} caseData={c} onTap={handleCaseTap} />
            ))}
          </div>
        ) : (
          // All: grouped by topic
          Object.entries(groups).map(([topicName, cases]) => (
            <div key={topicName} style={{ marginBottom: "16px" }}>
              <div style={{
                fontSize: "11px", fontWeight: 600, color: T.textMuted,
                textTransform: "uppercase", letterSpacing: "0.05em", padding: "0 4px 6px",
              }}>
                {topicName}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {cases.map(c => (
                  <CaseCard key={c.id} caseData={c} onTap={handleCaseTap} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Onboarding sheet */}
      {showOnboarding && <OnboardingSheet onClose={() => setShowOnboarding(false)} />}
    </div>
  );
}
