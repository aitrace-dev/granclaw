```markdown
# Design System Document: The Scholarly Sanctuary

## 1. Overview & Creative North Star
The North Star for this design system is **"The Scholarly Sanctuary."** Unlike traditional productivity apps that feel like sterile cockpits, this system is designed to feel like a private library—a quiet, intimate space for deep thought. 

We are moving away from the "software" aesthetic toward an "editorial" experience. This means rejecting the rigid, boxy constraints of standard UI in favor of intentional asymmetry, generous margins, and the tactile warmth of physical paper. The layout should feel less like a grid and more like a carefully composed manuscript where the content dictates the form.

## 2. Colors: Ink on Paper
The palette is rooted in the "Physical Analog" philosophy. We use high-contrast ink on warm, fibrous surfaces to reduce eye strain and promote long-form reading.

### Surface Hierarchy & The "No-Line" Rule
To achieve a premium, custom feel, **1px solid borders are prohibited for sectioning.** 
- **The Rule:** Boundaries must be defined through background color shifts. Use the `surface-container` tiers to create "nested" depth. 
- **Application:** A main writing area (`surface`) might sit next to a navigation panel (`surface-container-low`), while a search bar "floats" within it using `surface-container-lowest`. This creates a soft, architectural separation that feels far more sophisticated than a line.

### Color Tokens (Material Convention)
- **Background/Surface:** `#fef9ef` (The base "Paper" color).
- **On-Surface (Ink):** `#1d1c16` (Deep charcoal, never pure black).
- **Primary (Wikilink):** `#5d39e0` (A sophisticated, intellectual violet-blue).
- **Secondary (Tag):** `#b12e09` (A muted, earthy red-orange).
- **Tertiary (Highlight):** `#6a5f18` (A faded, sun-bleached yellow).

### Optical Depth
While the user requested "no gradients," we utilize **Grainy Tonal Bleeds** to prevent the UI from looking flat or "cheap." Instead of digital CSS gradients, use a 5% opacity noise texture overlaid across the entire UI. For main CTAs, use a nearly imperceptible shift from `primary` to `primary_container` to mimic how ink pools on a page.

## 3. Typography: The Editorial Voice
The typography is the soul of this system. It relies on the tension between a high-end transitional serif and a precise, functional monospaced face.

- **The Serif (Headlines & Body):** Use **Noto Serif** (as a proxy for Literata). This conveys authority and thoughtfulness. 
    - *Display-LG:* Use for entry points and main titles to create a "book cover" feel.
    - *Body-LG:* Set with generous line-height (1.6) to ensure the eye never tires.
- **The Mono (Labels & Meta):** Use **Space Grotesk** (Label tokens) or **JetBrains Mono**. 
    - This is used for "the machine" or "the system"—tags, file paths, and labels. It acts as the functional scaffolding for the creative serif text.

## 4. Elevation & Depth: Stacking the Manuscript
We avoid the "Material Design" look of heavy drop shadows. Instead, we use **Tonal Layering.**

- **The Layering Principle:** Depth is achieved by "stacking" surface tiers. Place a `surface-container-lowest` card on a `surface-container-low` section to create a soft, natural lift.
- **Glassmorphism (Frosted Vellum):** For floating elements like context menus or command palettes, use a semi-transparent `surface` color with a `20px` backdrop-blur. This mimics the look of frosted vellum paper, allowing the text beneath to "ghost" through without distracting the user.
- **Ambient Shadows:** If a shadow is required for a modal, use a "Tinted Ambient Shadow": 
    - `box-shadow: 0 10px 40px rgba(29, 28, 22, 0.06);` 
    - The shadow color is derived from the `on-surface` ink, making it feel like a natural light obstruction rather than a digital effect.
- **The Ghost Border:** For high-density components (like input fields), use the `outline-variant` token at 15% opacity. This provides a "suggestion" of a container without breaking the scholarly atmosphere.

## 5. Components

### Markdown-Style Elements
- **Blockquotes:** Do not use a vertical line. Instead, use a `surface-container-highest` background with an increased left-padding and *Italic Body-LG* serif text.
- **Callouts (`> [!note]`):** Styled as "In-set Plates." Use a subtle background shift (e.g., `primary-container` at 10% opacity) and a unique icon from the mono set.

### Interaction Elements
- **Buttons:**
    - *Primary:* A solid `primary` block with `on-primary` text. No rounded corners (use `sm` scale: `0.125rem`).
    - *Secondary:* `ghost-border` style. It should feel like a button stamped into the paper.
- **Tag Chips:** Use `secondary-fixed-dim` background with `on-secondary-fixed` text. The shape should be a "pill" (`full` roundedness) to contrast against the sharp-edged page elements.
- **File Tree Navigation:** No dividers. Use indentation and a `primary` color vertical bar (2px) only on the *Active* file. Hover states should be a simple shift to `surface-container-high`.

### Input Fields
- **Text Inputs:** Use a "Minimalist Ledger" style. Only a bottom border using `outline-variant` at 30% opacity. When focused, the label (using `label-md`) shifts to `primary` color.

## 6. Do’s and Don’ts

### Do:
- **Embrace Asymmetry:** Allow for wider left margins in the file tree than the right margin of the editor. It feels more like a physical notebook.
- **Use "White Space" as a Tool:** Spacing is not "empty"; it is a luxury. Use it to separate thoughts rather than using lines.
- **Layering over Shadowing:** Always try to solve a hierarchy problem with a background color shift before reaching for a shadow.

### Don’t:
- **Don’t use 100% Opaque Borders:** This immediately kills the "premium" editorial feel and makes the app look like a standard template.
- **Don’t use Vibrant Gradients:** Avoid any "tech-bro" neon or vibrant linear transitions. If a gradient is used, it must be "muddy" and organic.
- **Don’t Center Everything:** Scholarly work is often left-aligned or intentionally offset. A perfectly centered layout can feel too "marketing-heavy" for a personal knowledge tool.

### Accessibility Note:
While we use subtle tonal shifts, always ensure that the contrast between text (`on-surface`) and its immediate background (`surface-container` tiers) meets WCAG AA standards. The "Ink on Paper" high-contrast approach inherently supports this.```