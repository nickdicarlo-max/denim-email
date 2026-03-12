# Phase 1: Schema Quality Evaluation

**Date:** 2026-03-12
**Model:** claude-sonnet-4-6

## Summary

| Domain | Result | Checks | Latency | Tokens (in/out) |
|---|---|---|---|---|
| School Parent | PASS | 10/10 | 25678ms | 1790/2341 |
| Property Manager | PASS | 10/10 | 21586ms | 1783/2403 |
| Construction | PASS | 10/10 | 25538ms | 1818/2661 |
| Agency | PASS | 10/10 | 24146ms | 1760/2347 |
| Legal | PASS | 10/10 | 27245ms | 1778/2772 |

## Cross-Domain Clustering Constants

| Domain | mergeThreshold | timeDecay.fresh | caseSizeThreshold | reminderCollapse |
|---|---|---|---|---|
| School Parent | 35 | 60 | 5 | true |
| Property Manager | 45 | 45 | 10 | false |
| Construction | 45 | 45 | 10 | false |
| Agency | 45 | 45 | 8 | false |
| Legal | 55 | 90 | 15 | false |

## Detailed Results

### School Parent

- [x] **Primary entity type:** "Program" - A school or sports organization the parent's child is enrolled in or participates with
- [x] **At least 5 tags:** 8 tags: Action Required, Schedule, Payment, Permission/Form, Game/Match, Practice, Cancellation, Volunteer
- [x] **No generic tags:** All domain-specific
- [x] **Domain-specific clustering:** mergeThreshold=35, timeDecay.fresh=60, caseSizeThreshold=5, reminderCollapse=true
- [x] **Summary labels:** What / Details / Action Needed
- [x] **Discovery queries reference entities:** 10 queries: subject:"Vail Mountain School"; subject:VMS; from:vailmountainschool.org; subject:"Eagle Valley SC"; subject:EVSC; from:eaglevalleysc.org; from:Martinez subject:(practice OR game OR schedule OR team); from:Patterson subject:(class OR homework OR assignment OR permission OR field trip); subject:(practice OR game OR match OR schedule OR cancelled OR cancellation OR permission OR dues OR fee OR volunteer); subject:("action required" OR "please sign" OR "permission slip" OR "RSVP" OR "reminder")
- [x] **Actionable extracted fields:** 1 showOnCard: eventDate
- [x] **Entity aliases generated:** Vail Mountain School: [VMS, Vail Mountain, vailmountainschool.org, Vail Mountain School Eagles]; Eagle Valley SC: [EVSC, Eagle Valley Soccer Club, Eagle Valley SC Eagles, eaglevalleysc.org]; Coach Martinez: [Martinez, Coach M]; Mrs. Patterson: [Patterson, Ms. Patterson, M. Patterson]
- [x] **All whats as PRIMARY entities:** Input: Vail Mountain School, Eagle Valley SC -> Found: Vail Mountain School, Eagle Valley SC
- [x] **Goals affect showOnCard:** Goals: actions, schedule -> showOnCard: eventdate

**Schema name:** Vail Mountain School & Eagle Valley SC Parent Tracker
**Primary entity:** Program
**Secondary types:** Coach, Teacher, Administrator, Parent, Organization
**Exclusion patterns:** noreply@, no-reply@, newsletter@, marketing@, promotions@, donotreply@, updates@, notifications@, digest@, alerts@

### Property Manager

- [x] **Primary entity type:** "Property" - A managed real estate property tracked as a distinct case boundary, grouping all related communications, maintenance, tenant, and financial emails.
- [x] **At least 5 tags:** 8 tags: Maintenance, Tenant, Vendor, Financial, Lease, Inspection, Compliance, Emergency
- [x] **No generic tags:** All domain-specific
- [x] **Domain-specific clustering:** mergeThreshold=45, timeDecay.fresh=45, caseSizeThreshold=10, reminderCollapse=false
- [x] **Summary labels:** Issue / Activity / Status
- [x] **Discovery queries reference entities:** 12 queries: subject:"123 Main St" OR subject:"123 Main Street"; "123 Main St" OR "123 Main Street"; subject:"456 Oak Ave" OR subject:"456 Oak Avenue"; "456 Oak Ave" OR "456 Oak Avenue"; subject:"789 Elm St" OR subject:"789 Elm Street"; "789 Elm St" OR "789 Elm Street"; from:"quickfixplumbing" OR subject:"Quick Fix Plumbing"; subject:maintenance OR subject:repair OR subject:work order; subject:invoice OR subject:payment OR subject:rent; subject:lease OR subject:renewal OR subject:termination; subject:inspection OR subject:report OR subject:violation; subject:emergency OR subject:urgent OR subject:ASAP
- [x] **Actionable extracted fields:** 1 showOnCard: cost
- [x] **Entity aliases generated:** 123 Main St: [123 Main Street, Main St, 123 Main]; 456 Oak Ave: [456 Oak Avenue, Oak Ave, 456 Oak]; 789 Elm St: [789 Elm Street, Elm St, 789 Elm]; Quick Fix Plumbing: [Quick Fix, QuickFix Plumbing, Quick Fix Plumbing Co]
- [x] **All whats as PRIMARY entities:** Input: 123 Main St, 456 Oak Ave, 789 Elm St -> Found: 123 Main St, 456 Oak Ave, 789 Elm St
- [x] **Goals affect showOnCard:** Goals: costs, status -> showOnCard: cost

**Schema name:** Property Management Schema
**Primary entity:** Property
**Secondary types:** Tenant, Vendor, Inspector, Contractor, Agent
**Exclusion patterns:** noreply@, no-reply@, newsletter@, marketing@, alerts@, donotreply@, notifications@, updates@, info@zillow.com, info@realtor.com, digest@, promotions@

### Construction

- [x] **Primary entity type:** "Project" - A construction project tracked as a case boundary, grouping all related emails, RFIs, submittals, and correspondence
- [x] **At least 5 tags:** 8 tags: RFI, Change Order, Submittal, Schedule, Permits, Safety, Invoice/Payment, Punch List
- [x] **No generic tags:** All domain-specific
- [x] **Domain-specific clustering:** mergeThreshold=45, timeDecay.fresh=45, caseSizeThreshold=10, reminderCollapse=false
- [x] **Summary labels:** Issue / Progress / Current Status
- [x] **Discovery queries reference entities:** 16 queries: subject:"Harbor View Renovation"; subject:"Harbor View"; "Harbor View Renovation" OR "HVR"; subject:"Elm Street Addition"; subject:"Elm Street"; "Elm Street Addition" OR "ESA"; from:comfortairsolutions OR from:comfortair; "Comfort Air Solutions" OR "Comfort Air"; from:torresengineering OR from:torres; "Torres Engineering" OR "Torres Eng"; subject:RFI; subject:"Change Order"; subject:Submittal; subject:"Punch List"; subject:Invoice OR subject:"Payment Application"; subject:Permit OR subject:Inspection
- [x] **Actionable extracted fields:** 2 showOnCard: cost, deadline
- [x] **Entity aliases generated:** Harbor View Renovation: [Harbor View, HarborView, Harbor View Reno, HVR]; Elm Street Addition: [Elm Street, Elm St Addition, Elm St, ESA]; Comfort Air Solutions: [Comfort Air, CAS, Comfort Air HVAC]; Torres Engineering: [Torres Eng, Torres, Torres Engineering Group]
- [x] **All whats as PRIMARY entities:** Input: Harbor View Renovation, Elm Street Addition -> Found: Harbor View Renovation, Elm Street Addition
- [x] **Goals affect showOnCard:** Goals: costs, deadlines -> showOnCard: cost, deadline

**Schema name:** Construction Project Management
**Primary entity:** Project
**Secondary types:** Subcontractor, Architect, Engineer, Inspector, Owner Representative
**Exclusion patterns:** noreply@, no-reply@, newsletter@, marketing@, system@, donotreply@, notifications@, alerts@, updates@, mailer@, automailer@, bounce@, unsubscribe@

### Agency

- [x] **Primary entity type:** "Project" - A client project or campaign being managed by the agency, used as the primary case boundary for organizing related emails.
- [x] **At least 5 tags:** 8 tags: Deliverable, Feedback, Approval, Timeline, Meeting, Creative, Budget, Strategy
- [x] **No generic tags:** All domain-specific
- [x] **Domain-specific clustering:** mergeThreshold=45, timeDecay.fresh=45, caseSizeThreshold=8, reminderCollapse=false
- [x] **Summary labels:** Brief / Progress / Status
- [x] **Discovery queries reference entities:** 12 queries: subject:"Acme Corp rebrand"; subject:"Acme rebrand" OR subject:"Acme rebranding" OR subject:"Acme brand refresh"; "Acme Corp rebrand" OR "Acme rebrand" OR "Acme rebranding"; subject:"Widget Inc Q2"; subject:"Widget Q2" OR subject:"Widget Inc Q2 campaign" OR subject:"Widget second quarter"; "Widget Inc Q2" OR "Widget Q2" OR "Widget second quarter"; from:sarah; subject:deadline OR subject:due date OR subject:deliverable; subject:approval OR subject:approve OR subject:review; subject:feedback OR subject:revisions OR subject:comments; subject:budget OR subject:invoice OR subject:overage; subject:creative brief OR subject:concept OR subject:design
- [x] **Actionable extracted fields:** 1 showOnCard: deadline
- [x] **Entity aliases generated:** Acme Corp rebrand: [Acme rebrand, Acme Corp, Acme rebranding, Acme brand refresh]; Widget Inc Q2: [Widget Q2, Widget Inc, Widget Inc Q2 campaign, Widget second quarter]; Sarah at Acme: [Sarah, Sarah Acme, Sarah (Acme Corp)]
- [x] **All whats as PRIMARY entities:** Input: Acme Corp rebrand, Widget Inc Q2 -> Found: Acme Corp rebrand, Widget Inc Q2
- [x] **Goals affect showOnCard:** Goals: deadlines, actions -> showOnCard: deadline

**Schema name:** Agency Project Tracker
**Primary entity:** Project
**Secondary types:** Client Contact, Account Manager, Creative Director, Strategist, Vendor
**Exclusion patterns:** noreply@, no-reply@, newsletter@, marketing@, notifications@, donotreply@, do-not-reply@, alerts@, updates@, digest@, news@, promotions@, unsubscribe@

### Legal

- [x] **Primary entity type:** "Legal Matter" - A distinct legal case, proceeding, or transaction being tracked and managed
- [x] **At least 5 tags:** 8 tags: Deadline, Filing, Discovery, Motion, Hearing, Settlement, Billing, Correspondence
- [x] **No generic tags:** All domain-specific
- [x] **Domain-specific clustering:** mergeThreshold=55, timeDecay.fresh=90, caseSizeThreshold=15, reminderCollapse=false
- [x] **Summary labels:** Matter / Proceedings / Status
- [x] **Discovery queries reference entities:** 13 queries: subject:"Smith v. Jones"; subject:"Smith vs Jones" OR subject:"Smith v Jones"; "Smith v. Jones" OR "Smith vs Jones" OR "Smith v Jones"; subject:"Acme Corp acquisition"; subject:"Acme acquisition" OR subject:"Acme Corp"; "Acme Corp acquisition" OR "Acme acquisition" OR "Acme transaction"; from:"Johnson & Associates" OR from:"johnsonassociates" OR "Johnson & Associates"; subject:deadline OR subject:"due date" OR subject:"filing deadline"; subject:motion OR subject:brief OR subject:filing; subject:hearing OR subject:conference OR subject:deposition; subject:settlement OR subject:"settlement offer" OR subject:negotiation; subject:discovery OR subject:"document request" OR subject:subpoena; subject:invoice OR subject:"legal fees" OR subject:billing OR subject:retainer
- [x] **Actionable extracted fields:** 4 showOnCard: deadline, caseStatus, hearingDate, caseNumber
- [x] **Entity aliases generated:** Smith v. Jones: [Smith vs Jones, Smith v Jones, Smith versus Jones, Smith/Jones matter, Smith Jones litigation, Smith Jones case]; Acme Corp acquisition: [Acme acquisition, Acme Corp deal, Acme transaction, Acme Corp merger, Acme purchase, Acme Corp M&A]; Johnson & Associates: [Johnson and Associates, Johnson Associates, Johnson & Assoc, Johnson Law]
- [x] **All whats as PRIMARY entities:** Input: Smith v. Jones, Acme Corp acquisition -> Found: Smith v. Jones, Acme Corp acquisition
- [x] **Goals affect showOnCard:** Goals: deadlines, status -> showOnCard: deadline, casestatus, hearingdate, casenumber

**Schema name:** Legal Case Management
**Primary entity:** Legal Matter
**Secondary types:** Attorney, Paralegal, Judge, Opposing Counsel, Client
**Exclusion patterns:** noreply@, no-reply@, newsletter@, marketing@, ecf@, donotreply@, do-not-reply@, notifications@, alerts@, unsubscribe@, automated@, system@, mailer-daemon@, bounce@, support@legaltracker.com, updates@westlaw.com, updates@lexisnexis.com

