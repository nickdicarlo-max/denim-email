# Design System

## Source of Truth

All visual values are defined in `packages/types/tokens.ts`. That file exports:
- `colors` -- every color in the system
- `typography` -- font families, sizes, weights, label styles
- `spacing` -- spacing scale and semantic spacing tokens
- `radii` -- border radius values
- `shadows` -- elevation levels
- `animation` -- durations, easings, presets
- `layout` -- side panel dimensions, touch targets, z-index scale
- `components` -- semantic tokens per component (card, button, input, etc.)
- `tailwindExtend` -- drop-in Tailwind config extension

Import tokens from `@denim/types/tokens`. Never hardcode color hex values, font
sizes, or spacing values in components. If a value doesn't exist in the token
file, add it there first, then reference it.

---

## Design Principles

### 1. Precision Instrument, Not Personality Brand

The product is a private utility. Nobody talks about it. Nobody shows it off.
It presents information clearly, beautifully, and without ego. Think of a
well-designed weather app or a car dashboard: you use it because it's the best
way to see what you need to see.

This means:
- No decorative elements, illustrations, or mascots
- No playful copy or brand voice in the UI (save that for the landing page)
- Every element earns its space by communicating information
- When in doubt, remove rather than add

### 2. Warm Neutral, Not Cold SaaS

The warm off-white background (`#F7F6F3`, token: `surface`) is the most important
design choice. It differentiates from every cold-white SaaS product and gives the
interface a paper-like quality that's comfortable for extended viewing.

White cards on the warm background create natural elevation without heavy shadows.
The border color (`#E8E6E1`) is warm too. Everything feels cohesive and calm.

### 3. Scannable in 2 Seconds

Every screen answers a question. The user should find the answer within 2 seconds.

| Screen | Question | 2-second target |
|---|---|---|
| Case feed | "What's happening?" | Scan 3-4 cards, see status labels |
| Case detail | "What's the story?" | Three-section summary visible without scrolling |
| Quality metrics | "Is this working?" | Big accuracy number, trend direction |
| Interview | "What do I do?" | One clear action per step |

If a screen takes longer than 2 seconds to parse, the information hierarchy is
wrong. The most important element should be the largest, highest-contrast element.

### 4. Mobile-First, Side-Panel Native

Everything is designed for 375px minimum width. The Chrome side panel is the
primary viewport (375-500px). Desktop web is secondary.

- Single column layout always
- Touch targets: minimum 44x44px
- No hover-only interactions (swipe is a progressive enhancement)
- No horizontal scrolling ever
- Generous vertical padding between cards (the user is scanning, not packing)

### 5. Motion is Functional, Not Decorative

Motion signals state changes: "this appeared," "this moved," "this completed."
Never decorative. Never bounce, spring, or parallax.

- Fade in (200ms) for new content
- Slide up (300ms) for bottom sheets
- Color transition (150ms) for hover/focus states
- No animation on page load
- No loading spinners longer than 3 seconds (show partial content instead)

---

## Color Usage

### When to Use Each Color

| Scenario | Color Token | Example |
|---|---|---|
| Page background | `surface` | Every screen's base |
| Card / elevated surface | `card` | Case cards, input containers |
| Disabled / empty state | `subtle` | Reassurance boxes, disabled buttons |
| Primary text | `primary` | Card titles, body text |
| Supporting text | `secondary` | Descriptions, sender names |
| De-emphasized text | `muted` | Timestamps, hints, "2h ago" |
| Interactive element | `accent` | Buttons, links, focus rings |
| Selected / active state | `accentSoft` | Selected filter tab, active chip |
| Positive / resolved | `success` | Resolved badge, completed action |
| Attention needed | `warning` | Active status label, pending action |
| Error / destructive | `error` | Error messages, thumbs down (use sparingly) |
| System learning | `improving` | Accuracy %, calibration bar |
| Primary entity chip | `entityPrimary` | "Vail Mountain School" chip |
| Secondary entity chip | `entitySecondary` | "Coach Martinez" chip |

### Color Accessibility

- `primary` on `surface`: contrast ratio 12.6:1 (passes AAA)
- `primary` on `card`: contrast ratio 15.3:1 (passes AAA)
- `secondary` on `surface`: contrast ratio 5.1:1 (passes AA)
- `muted` on `surface`: contrast ratio 3.2:1 (passes AA for large text only)
- `accent` on `card`: contrast ratio 4.9:1 (passes AA)
- `inverse` on `accent`: contrast ratio 6.4:1 (passes AA)

Muted text (`#9B9B9B`) should only be used for non-essential information
(timestamps, hints). Never use it for actionable content.

---

## Typography

### Font Stack

**Primary (sans):** DM Sans with system fallbacks. Clean, slightly geometric,
professional without being cold. If the brand direction shifts toward more
precision, consider Geist or Satoshi as alternatives.

**Monospace:** JetBrains Mono for data values (costs, counts, metrics).
Used sparingly but consistently for anything that's a measurement.

### Usage by Context

| Context | Size | Weight | Token |
|---|---|---|---|
| Screen title | `lg` (17px) | semibold (600) | -- |
| Card title | `base` (14px) | semibold (600) | -- |
| Body text | `base` (14px) | normal (400) | -- |
| Button text | `md` (15px) | semibold (600) | -- |
| Tag label | `sm` (12px) | medium (500) | -- |
| Timestamp | `xs` (11px) | normal (400) | -- |
| Status label | `label` (10px) | semibold (600) | uppercase, tracked |
| Metric value | `lg` (17px) | semibold (600) | mono font |
| Cost / amount | `sm` (12px) | semibold (600) | mono font |

### Rules

- Never go below 11px (`xs`). If content doesn't fit, truncate with ellipsis.
- Never use bold (700) in the side panel. Semibold (600) is the maximum emphasis.
- Status labels are always uppercase with `letterSpacing: 0.04em`.
- Monospace is ONLY for numbers that are measurements: "$2,400", "8 emails", "94%".
  Never use mono for text content.

---

## Component Patterns

### Case Card

```
┌─────────────────────────────────────────┐
│ Kitchen Remodel Permits              ›  │  title (base, semibold)
│ Mike Chen, City Planning        2h ago  │  secondary + muted
│ STATUS: Final permit approved pending   │  label (uppercase) + secondary
│  inspection scheduling.                 │
│ ☐ Schedule inspection (due Mar 15)      │  action item (if present)
│ [Permits] [Timeline]  ✉ 8   Cost $2,400│  tags + count + highlight
└─────────────────────────────────────────┘
```

- Background: `card` with `border` and `shadow.md`
- Hover: `shadow.lg` (not background color change)
- Border radius: `lg` (12px)
- Padding: `14px 16px` (cardPadding token)
- Gap between cards: `8px` (cardGap token)

### Entity Chips

Blue chip (primary / "what"):
- Background: `entityPrimaryBg` (#EFF4FF)
- Border: `1.5px solid entityPrimary` (#2563EB)
- Text: `accentText`
- Border radius: `full`

Amber chip (secondary / "who"):
- Background: `entitySecondaryBg` (#FFFBEB)
- Border: `1.5px solid entitySecondary` (#D97706)
- Text: `warningText`
- Border radius: `full`

### Tags / Pills

- Background: `subtle` (#F0EFEB) for neutral tags
- Background: semantic soft color for typed tags (e.g., `successSoft` for resolved)
- Text: `secondary` for neutral, semantic text color for typed
- Border radius: `full`
- Padding: `4px 8px`
- Font: `sm` (12px), medium weight

### Buttons

**Primary:** Solid accent background, inverse text. Used for main CTAs
("Connect my email", "Looks good", "Start free trial"). Maximum one per screen.

**Secondary:** White background, border, primary text. Used for secondary actions
("Add another", "Skip"). Border darkens on hover.

**Ghost:** No background, accent text. Used for tertiary actions ("Cancel",
inline links). No border.

**Destructive:** Error background, inverse text. Used only for irreversible
actions. Should be rare.

### Inputs

- White background, warm border (`1.5px solid border`)
- On focus: border transitions to accent blue (`1.5px solid accent`)
- Border radius: `md` (8px)
- No floating labels. Label above the input as a separate element.
- Placeholder text: `muted` color
- Validation error: border turns `error`, help text in `errorText` below

### Bottom Sheets

- Slide up from bottom with 300ms ease-out
- White background, top corners rounded `xl` (16px)
- Handle bar: 40px wide, 4px tall, `border` color, centered, 8px from top
- Overlay behind: `overlay` (rgba black 0.4)
- Content starts 24px below handle
- Tap overlay or swipe down to dismiss

### Toasts

- Dark background (`primary` / near-black), inverse text
- Border radius: `full` (pill shape)
- Appear from bottom center, fade in 200ms
- Auto-dismiss after 3 seconds
- Action text (e.g., "Undo") in accent color

### Status Labels

Always uppercase, tracked, tiny. Color communicates the state:

- **STATUS:** (amber) for active cases
- **RESOLVED:** (green) for completed cases
- **CALIBRATING:** (indigo/improving) for the accuracy system

### Metric Bar

- Background track: `subtle`
- Progress fill: `improving` (indigo)
- Height: 6px, border radius: `sm`
- Accuracy text: `lg` mono, semibold

### Summary Section Dots

Three colored dots mark the beginning/middle/end of a case summary:
- Beginning: accent (blue) -- "What happened"
- Middle: warning (amber) -- "What's developing"
- End: success (green) -- "Where it stands"

These dots are 8px circles, inline with the section header text.

---

## Responsive Behavior

| Breakpoint | Context | Behavior |
|---|---|---|
| 375px | Phone / minimum | Single column, all features |
| 420px | Chrome side panel (default) | Single column, slightly more breathing room |
| 500px | Wide side panel | Single column, max useful width |
| 768px+ | Web app (admin dashboard) | Can use two-column layouts |

The side panel never uses multi-column layouts. The admin dashboard (Phase 7)
can use wider layouts for data tables and debugging views.

---

## Iconography

Use Lucide React icons exclusively. Consistent 18px size in most contexts,
16px in compact contexts (inside tags, inline with small text).

- Stroke width: 1.5px (default Lucide)
- Color: inherit from text color (usually `secondary` or `muted`)
- No filled icons (too heavy for the aesthetic)
- No custom icons (maintain with Lucide updates)

**Common icons:**
- Mail (email count)
- ChevronRight (card navigation)
- ThumbsUp / ThumbsDown (feedback)
- Check (completed actions)
- Clock (due dates, timestamps)
- Calendar (calendar sync)
- Plus (add entity/tag)
- X (remove, close)
- Settings (schema settings)
- Activity (quality metrics / pulse)
- Sparkles (AI-generated content indicator)

---

## Accessibility

### Keyboard Navigation

- All interactive elements must be focusable via Tab
- Focus ring: 2px `accent` with 2px offset (visible on `surface` background)
- Enter/Space activates buttons and toggles
- Escape closes bottom sheets and modals

### Screen Readers

- All images and icons have `aria-label` or are `aria-hidden`
- Status labels include the full context: `aria-label="Status: Active"`
- Dynamic content updates use `aria-live="polite"` regions
- Bottom sheets use `role="dialog"` with `aria-modal="true"`

### Color Independence

- Never use color alone to communicate state. Always pair with:
  - Text label ("STATUS:", "RESOLVED:")
  - Icon (check for done, clock for pending)
  - Position (resolved cases at bottom of list)

---

## Anti-Patterns

Things this design system explicitly avoids:

- **Gradients.** No gradients anywhere. Flat colors with elevation via shadow.
- **Rounded images / avatars.** No user avatars or profile photos in the UI.
- **Emoji in the product UI.** Allowed only on the interview role selection cards.
  Never in the case feed, detail, or settings.
- **Skeleton loading screens.** Use a simple fade-in when content arrives.
  Skeleton screens suggest the product is slow.
- **Infinite scroll.** Case feeds are finite (typically 5-30 cases). Load all at once.
- **Dark mode (for now).** Ship light mode only. Add dark mode post-launch if users ask.
  Premature dark mode doubles the design surface area.
- **Custom scrollbars.** Use native browser scrollbars.
- **Notification badges / red dots.** The product is a calm presence, not another
  source of notification anxiety. New cases just appear in the feed.

---

## Stitch MCP (Google Design Tool)

Stitch by Google is connected via MCP for AI-driven UI design generation. It uses Gemini to generate UI designs and HTML/CSS from natural language prompts.

### Available Tools

**Design Generation:**
- `generate_screen_from_text` -- Create UI designs from natural language. Params: `project_id`, `prompt`, `model_id` (GEMINI_3_PRO or GEMINI_3_FLASH)

**Code & Image Extraction:**
- `get_screen_code` / `fetch_screen_code` -- Get raw HTML/CSS for a screen
- `get_screen_image` / `fetch_screen_image` -- Get high-res screenshot (base64)
- `extract_design_context` -- Extract "Design DNA" (fonts, colors, layouts) for consistency

**Project & Screen Management:**
- `create_project`, `list_projects`, `get_project` -- Manage design projects
- `list_screens`, `get_screen` -- Browse screens within a project

**Site Building:**
- `build_site` -- Map screens to routes, returns deployable HTML

### Design-to-Code Workflow

1. Generate screens in Stitch via natural language prompts
2. Extract Design DNA with `extract_design_context` to capture fonts, colors, layout rules
3. Fetch screen code with `get_screen_code` for implementation reference
4. Build components in React + Tailwind using the extracted design tokens
5. Compare browser output against Stitch screenshots for visual fidelity

### Usage Notes
- Configured via HTTP transport with API key (local MCP config, not committed)
- Rate limit: 350 generations/month (standard tier)
- Use `extract_design_context` before coding to keep styles consistent across screens
- Stitch designs drive the UX overhaul (Phases 2-3)
