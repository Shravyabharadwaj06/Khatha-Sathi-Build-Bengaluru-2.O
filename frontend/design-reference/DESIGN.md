---
name: Editorial Merchant
colors:
  surface: '#faf9f5'
  surface-dim: '#dbdad6'
  surface-bright: '#faf9f5'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f4f0'
  surface-container: '#efeeea'
  surface-container-high: '#e9e8e4'
  surface-container-highest: '#e3e2df'
  on-surface: '#1b1c1a'
  on-surface-variant: '#464650'
  inverse-surface: '#2f312e'
  inverse-on-surface: '#f2f1ed'
  outline: '#777681'
  outline-variant: '#c7c5d2'
  surface-tint: '#55579d'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#0f0f56'
  on-primary-container: '#7b7dc5'
  inverse-primary: '#c0c1ff'
  secondary: '#636100'
  on-secondary: '#ffffff'
  secondary-container: '#ece942'
  on-secondary-container: '#696700'
  tertiary: '#000001'
  on-tertiary: '#ffffff'
  tertiary-container: '#051f24'
  on-tertiary-container: '#6f888f'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e1e0ff'
  primary-fixed-dim: '#c0c1ff'
  on-primary-fixed: '#0f0f56'
  on-primary-fixed-variant: '#3d3f83'
  secondary-fixed: '#ece942'
  secondary-fixed-dim: '#cfcc23'
  on-secondary-fixed: '#1d1d00'
  on-secondary-fixed-variant: '#4a4900'
  tertiary-fixed: '#cde7ee'
  tertiary-fixed-dim: '#b1cbd2'
  on-tertiary-fixed: '#051f24'
  on-tertiary-fixed-variant: '#334a50'
  background: '#faf9f5'
  on-background: '#1b1c1a'
  surface-variant: '#e3e2df'
typography:
  headline-xl:
    fontFamily: Barlow Condensed
    fontSize: 56px
    fontWeight: '700'
    lineHeight: 60px
    letterSpacing: -0.01em
  headline-xl-mobile:
    fontFamily: Barlow Condensed
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Barlow Condensed
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: 0em
  headline-lg-mobile:
    fontFamily: Barlow Condensed
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: 0em
  headline-md:
    fontFamily: Barlow Condensed
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: 0.01em
  headline-sm:
    fontFamily: Barlow Condensed
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: 0.02em
  body-lg:
    fontFamily: Work Sans
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Work Sans
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Work Sans
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-lg:
    fontFamily: Work Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: 0.03em
  label-md:
    fontFamily: Work Sans
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.04em
  label-sm:
    fontFamily: Work Sans
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.06em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-desktop: 2.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

The design system is crafted for neighborhood commerce, micro-entrepreneurs, and local shopkeepers navigating digital inventory, invoicing, customer orders, and voice-assisted operations. It bridges pragmatic street-level commerce with clear, high-craft editorial design.

### Design Movement & Aesthetic
- **Editorial Modernism:** Strong architectural layouts driven by condensed, impactful typographic headlines, high-contrast ink-like deep indigo text, and generous warm-white/cream breathing room.
- **Utilitarian Warmth:** Rooted in clean functional structure without feeling cold or detached. Color is applied in solid, intentional blocks (no gradients) to convey instant clarity in bustling retail environments.
- **Physical Ledger Spirit:** Tactile, grounded geometry featuring strictly rectangular and slightly softened contours (`rounded-sm` or `rounded-md`). Pill-shaped buttons are explicitly rejected to preserve an authoritative, disciplined, ledger-like aesthetic.

## Colors

The color architecture is built around sharp structural contrast, natural canvas warmth, and localized pastel and vibrant accents for status and categorization. Gradients are prohibited across all surfaces.

### Core Palette & Roles
- **Primary Deep Indigo (`#0F0F56`):** The structural anchor. Used for primary typography, authoritative buttons, dominant cards, borders, navigation bars, and strong visual weight.
- **Secondary Vivid Yellow (`#EDEA43`):** High-energy attention driver. Reserved for primary calls-to-action, key badges, voice recording triggers, and alert banners that demand instantaneous shopkeeper focus.
- **Tertiary Pale Blue (`#C2DCE3`):** Informational support. Applied to system notices, order verification badges, secondary card backdrops, and active row highlights.
- **Warm Peach (`#FDDBA4`):** Category accent for inventory alerts, credit/khata tracking, and pending status tags.
- **Lavender (`#DEC3EB`):** Secondary accent for multilingual/voice indicators, AI prompt suggestions, and promotional tags.
- **Canvas Base (`#FAF9F5` / `#FFFFFF`):** High-readability cream and pure white backgrounds that reduce screen glare under overhead shop lights while retaining paper-like warmth.

## Typography

The typographic hierarchy couples **Barlow Condensed** for headlines with **Work Sans** for UI prose, data tables, and operational inputs.

### Typographic Principles
- **Commanding Editorial Headlines:** Barlow Condensed provides an authoritative, industrial posture reminiscent of merchant receipts, bills of lading, and bold newspaper broadsheets. All major display headlines are set in uppercase or title case with tight line spacing.
- **High-Density Body Legibility:** Work Sans provides robust optical clarity on low-tier mobile screens under variable ambient shop lighting. Its open counters prevent small glyphs from blurring together during multilingual text display.
- **Numeric & Ledger Formatting:** Tabular figures and invoice numerals in Work Sans maintain strict baseline alignment across inventory counts and monetary calculations.

## Layout & Spacing

The spatial model balances high-density data display with crisp structural dividers.

### Grid & Responsive Behavior
- **Mobile (<768px):** 4-column fluid layout with `1rem` margins and `1rem` gutters. Content stacks into compact, high-contrast visual blocks designed for rapid thumb interactions and one-handed counter usage.
- **Tablet (768px–1024px):** 8-column layout with `1.5rem` margins, enabling split-pane layouts for transaction entry and live voice-translation transcription.
- **Desktop (>1024px):** 12-column layout maxed at 1280px with `2.5rem` canvas margins. Asymmetrical column pairings (e.g., 5-column ledger summary next to a 7-column order feed) evoke editorial balance.
- **Spacing Cadence:** Derived strictly from an 8pt base grid (`0.25rem` to `2.5rem`). Dense padding (`space-xs` and `space-sm`) is utilized within ledger cells, while outer component padding uses `space-md` and `space-lg` to prevent clutter.

## Elevation & Depth

This design system avoids heavy shadows, 3D skeuomorphism, and floaty glassmorphism. It uses low-contrast architectural borders and flat tonal layering to establish structure.

### Depth Techniques
- **Surface Layering:** The primary level rests on `#FAF9F5`. Raised panels, action bars, and modal drawers sit on pure `#FFFFFF` bounded by crisp 1px borders in `#0F0F56` (at full opacity or 12% tint).
- **Ink-Line Dividers:** Hierarchy is defined by 1px solid structural lines rather than drop shadows. Hairlines delineate column boundaries, table headers, and status cards.
- **Hard Subtle Offsets (Optional Accent Elevation):** When actionable interactive emphasis is necessary, a flat 2px or 3px solid ink offset shadow (`box-shadow: 2px 2px 0px #0F0F56`) may be applied to primary cards and buttons, echoing print registration and physical stamps. Soft, diffused blur shadows are never permitted.

## Shapes

The shape system is strictly architectural, sharp, and disciplined. 

### Corner Geometry
- **Roundedness Level:** `1` (Soft). Base UI elements (buttons, inputs, status tags) feature subtle 4px (`0.25rem`) corner rounding. Larger surfaces like containers and modal cards cap out at 8px (`0.5rem`).
- **Pill-Shape Prohibition:** Stadium or pill-shaped buttons (`rounded-full`) are strictly forbidden. Rectangular contours with micro-radii uphold the tactile ledger aesthetic and ensure maximum screen efficiency for multilingual translated strings.

## Components

### Buttons
- **Primary:** Deep Indigo (`#0F0F56`) fill with pure white typography, 4px border radius (`rounded-sm`), 1px solid `#0F0F56` border. Hover/active shifts to a sharp offset shadow (`2px 2px 0px #0F0F56`). No rounded pills.
- **Accent (Action/Voice):** Vivid Yellow (`#EDEA43`) fill with Deep Indigo text and a 1.5px `#0F0F56` border. Used for critical conversion steps (e.g., "Add Transaction", "Start Voice Order").
- **Secondary / Outline:** White or transparent fill with a 1px solid `#0F0F56` stroke and `#0F0F56` text.

### Chips & Badges
- **Form:** Rectangular with 2px to 4px corners. Padding: `4px 10px`. Text set in uppercase `label-md`.
- **Status Accents:** Flat fills utilizing the palette:
  - *Order Confirmed / Active:* Pale Blue (`#C2DCE3`) background, `#0F0F56` text.
  - *Pending / Khata Due:* Warm Peach (`#FDDBA4`) background, `#0F0F56` text.
  - *Voice / Multi-Language:* Lavender (`#DEC3EB`) background, `#0F0F56` text.
  - *Attention / Urgent:* Vivid Yellow (`#EDEA43`) background, `#0F0F56` text.

### Lists & Ledger Rows
- Minimal vertical padding (`space-sm` to `space-md`) with 1px solid border (`#0F0F56` at 12% opacity) between rows.
- Left-aligned item title in `body-md` bold, right-aligned monetary values in tabular `body-md`. Alternate row background toggles between `#FAF9F5` and `#FFFFFF`.

### Checkboxes & Radio Buttons
- **Checkbox:** Square, 18px x 18px, 2px radius, 1.5px solid `#0F0F56`. When checked, solid `#0F0F56` fill with an inverted white checkmark.
- **Radio Button:** 18px circular indicator with 1.5px solid `#0F0F56`. Selected state displays an inner solid `#0F0F56` dot with a 3px white gap.

### Input Fields
- White (`#FFFFFF`) surface, 4px border radius, 1px solid `#0F0F56` stroke.
- Focus state: 2px solid `#0F0F56` border with zero blur glow.
- Multilingual and audio fields include an integrated microphone trigger button styled in Pale Blue or Lavender with a 1px vertical border separator.

### Cards & Panels
- Background: `#FFFFFF` or `#FAF9F5` with a 1px solid `#0F0F56` perimeter frame.
- Headers are set in uppercase `headline-sm` with an accompanying horizontal divider rule separating header from content.