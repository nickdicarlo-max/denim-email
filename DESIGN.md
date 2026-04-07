# Design System: The Digital Curator

## 1. Overview & Creative North Star
This design system is built upon the philosophy of **"The Digital Curator."** We are moving away from the sterile, modular appearance of standard SaaS platforms toward an editorial experience that feels tactile, warm, and highly intentional. 

Our North Star is the high-end lifestyle journal. We achieve this by rejecting rigid, boxy constraints in favor of **intentional asymmetry** and **tonal depth**. The interface should not look "built"; it should look "composed." By leveraging high-contrast typography scales and overlapping elements, we create a sense of physical layers—like fine vellum resting on heavy cardstock.

---

## 2. Colors & Surface Philosophy
The palette is a sophisticated blend of organic earth tones and muted minerals. We use color not just for branding, but as a structural tool.

### The Palette (Token References)
- **Primary (`#7d562d` / `primary`):** A deep, roasted caramel used for high-importance actions and brand emphasis.
- **Surface & Background (`#fbf9f6` / `surface`):** A warm cream that serves as our canvas.
- **Text (`#4a3f35` / `on_surface_variant`):** Espresso-toned ink. Never use pure black (#000); it breaks the tactile warmth.
- **Accents:** 
    - **Imminent (`#e27d60` / `secondary`):** A sun-baked coral for active or urgent states.
    - **Upcoming (`#85cdca` / `tertiary_container`):** A serene teal for future-dated or secondary interest points.

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders to define sections. We define boundaries through:
1.  **Background Shifts:** Use `surface_container_low` against `surface` to create natural breaks.
2.  **Tonal Transitions:** Creating soft zones of color rather than hard lines.

### Surface Hierarchy & Nesting
Treat the UI as a physical desk. Use the `surface_container` tiers to "stack" importance:
- **`surface_container_lowest`:** Reserved for the most prominent foreground cards (highest lift).
- **`surface_container`:** The standard mid-level background for content blocks.
- **`surface_container_highest`:** Used for "sunken" or recessed areas like search bars or footer regions.

### The "Glass & Gradient" Rule
To add "soul," use subtle linear gradients (e.g., `primary` to `primary_container`) on large CTAs. For floating navigation or modals, utilize **Glassmorphism**: semi-transparent surface tokens with a `20px` backdrop-blur to allow the warmth of the underlying content to bleed through.

---

## 3. Typography
Our typography is the primary driver of the "Editorial" feel. It balances the timeless authority of a serif with the modern precision of a geometric sans.

- **Display & Headlines (Noto Serif):** These are your "Voice." Use `display-lg` for hero moments. Encourage wide tracking (0.02em) and generous leading to let the words breathe.
- **Body & Titles (Plus Jakarta Sans):** This is your "Utility." Used for legibility and functional UI.
- **Hierarchy Hint:** Large Serif headlines paired with much smaller, all-caps Sans-Serif labels (`label-md`) create the "High-End Magazine" aesthetic.

---

## 4. Elevation & Depth
In this system, shadows are light, and depth is felt rather than seen.

### The Layering Principle
Depth is achieved by stacking `surface-container` tiers. Place a `surface_container_lowest` card on a `surface_container_low` background. This creates a "soft lift" that feels architectural rather than digital.

### Ambient Shadows
When a floating effect is required (e.g., a primary modal), use a **Warm Glow**:
- **Blur:** 40px - 60px.
- **Opacity:** 4% - 8%.
- **Color:** Use a tinted version of your primary or secondary color (e.g., a faint caramel glow) rather than grey.

### The "Ghost Border" Fallback
If a boundary is absolutely necessary for accessibility, use a **Ghost Border**:
- Token: `outline_variant`
- Opacity: **10% - 20% max.**
- Never use a 100% opaque border.

---

## 5. Components

### Cards
- **Radius:** `24px` (`lg`).
- **Styling:** No dividers. Use `2rem` (32px) of internal padding to ensure content feels curated. Use background tonal shifts to separate headers from body content within the card.

### Inputs & Search
- **Radius:** `12px` (Custom Scale).
- **Surface:** Use `surface_container_high` to create a "recessed" feel. 
- **States:** On focus, transition from a ghost border to a soft `primary` glow.

### Buttons
- **Primary:** High-contrast `primary` background with `on_primary` text. Use a subtle gradient to prevent a "flat" appearance.
- **Secondary:** `surface_container_highest` background. It should feel like a tactile pebble.
- **Tertiary/Ghost:** Text only, using `plusJakartaSans` in bold with a `primary` color.

### Chips & Tags
- **Shape:** `full` (pill-shaped).
- **Interaction:** Use `tertiary_fixed_dim` for upcoming items to give them a "minty" freshness that contrasts against the warm caramel.

---

## 6. Do's and Don'ts

### Do:
- **Use Intentional Asymmetry:** Align text to the left but offset images or decorative elements to create visual interest.
- **Embrace White Space:** If you think there is enough space, add 16px more. "The Digital Curator" is never crowded.
- **Use Tonal Layering:** Always check if a background color shift can replace a shadow or a line.

### Don't:
- **Don't use 1px Dividers:** They are the enemy of the "Tactile" feel. Use vertical whitespace instead.
- **Don't use pure Black/Grey:** Every "neutral" in this system should have a hint of brown or cream to maintain the "Espresso & Cloth" warmth.
- **Don't use Sharp Corners:** The minimum radius for any visible container is `8px`. We want the UI to feel soft to the touch.