# ui-library

A reusable, framework-free UI theme library. One markup set, many skins —
swap a single CSS file to reskin every component. No build step, no JavaScript
required for theming, no dependencies.

## Contents

- [Quick start](#quick-start)
- [What's inside](#whats-inside)
- [Themes](#themes)
- [Token contract](#token-contract)
- [Components](#components)
- [Design specs](#design-specs)
- [Accessibility](#accessibility)
- [Roadmap](#roadmap)
- [License](#license)

## Quick start

Two stylesheet links. That's the whole install:

```html
<link rel="stylesheet" href="ui-library/base.css">
<link rel="stylesheet" href="ui-library/themes/bento.css">
```

`base.css` owns all layout and component structure using CSS variables only —
it contains no hardcoded colors, fonts, radii, or shadows. Each
`themes/<id>.css` file sets those tokens plus a few theme-specific effects.
To change theme, point the second link at a different file:

```html
<link rel="stylesheet" href="ui-library/themes/cybercore.css">
```

Try it live: open `ui-library/demo.html` in any static server and flip the
theme dropdown — same markup, three skins.

## What's inside

| Path                | Purpose                                                        |
|---------------------|----------------------------------------------------------------|
| `base.css`          | Layout + all 20 components, variables only                     |
| `themes/*.css`      | One file per theme: design tokens + signature effects          |
| `styles.json`       | Machine-readable index: id, tags, best/avoid-for, fonts        |
| `DESIGN/<id>.md`    | Per-theme spec: tokens, type scale, rules, component notes     |
| `demo.html`         | Live switcher rendering every component in each theme          |

## Themes

| Theme        | Mode  | Fonts (Google)              | Shape / depth              | Motion              | Body-text contrast |
|--------------|-------|-----------------------------|----------------------------|---------------------|--------------------|
| `cybercore`  | dark  | Unbounded + Space Mono      | sharp, cut corners, glow   | glow + hover flicker| 17.1:1             |
| `claymorphism`| light | Archivo + Space Grotesk     | 26px radii, soft 3D clay   | bouncy spring       | 7.9:1              |
| `bento`      | light | Inter                       | 20px tiles, hairline edges | subtle lift         | 18.0:1             |

Contrast figures are the lowest body-text pair per theme, computed from the
token values (method: WCAG relative luminance). Every theme clears 4.5:1 —
see [Accessibility](#accessibility).

## Token contract

A theme file must define every token below. `base.css` never sets its own
values, so an incomplete theme visibly breaks — missing tokens are easy to
spot, not silent.

**Color:** `--bg --surface --surface-2 --text --muted --primary --on-primary
--secondary --on-secondary --border --success --warning --error`
(+ `--on-success/--on-warning/--on-error` where the theme needs them)

**Shape & depth:** `--radius --radius-sm --radius-pill --avatar-radius
--border-w --shadow --shadow-hover`

**Type:** `--font-body --font-head --font-mono --fs-display --fs-h1
--fs-h2 --fs-h3 --fs-body --fs-caption`

**Rhythm:** `--pad-sm --pad-md --pad-lg --gap --maxw --sidew`

**Behavior:** `--transition --hover-lift --hover-filter --active-press
--focus-ring`

Keep each theme file under ~150 lines: tokens first, then a short block of
signature effects (backgrounds, button treatments, glows). Anything generic
belongs in `base.css`.

## Components

Identical class names in every theme. Status: all implemented in `base.css`.

Buttons `.btn` (`.primary` `.secondary` `.ghost` `.icon`) · `.card` · `.nav` ·
`.sidebar` · `.table` (in `.table-wrap`) · `.input` · `.select` · `.toggle` ·
`.badge` (`.ok` `.warn` `.err`) · `.chip` · `.modal` (checkbox-driven) ·
`.tabs` (radio-driven) · `.accordion` (`<details>`) · tooltip via `[data-tip]` ·
`.stat-card` · `.progress` · `.avatar` (`.sm` `.lg`) · `.code-block` ·
`.hero` · `.footer`

Layout helpers: `.container` · `.grid` (`.cols-2` `.cols-3`) · `.layout`
(sidebar + main) · `.row` · `.stack` · `.muted` · `.caption`

Interactive states are part of the contract: every theme styles
hover, focus-visible, active, and disabled for buttons, inputs, toggles, and
tabs — each in its own motion language (flicker, bounce, fade).

## Design specs

Every theme ships a spec at `DESIGN/<id>.md` with the same six sections:

1. Color tokens table (bg, surface, text, muted, primary, secondary, border, success, warning, error)
2. Typography scale (display, h1–h3, body, caption, mono)
3. Spacing + radius + shadow tokens
4. Do / Don't rules (5 each)
5. Component notes (button, card, table in this theme's own language)
6. Best for / avoid for

Read the spec before editing a theme — it records *why* the tokens are what
they are (e.g. claymorphism buttons use dark ink on blue because white text
fails contrast there).

## Accessibility

- **Contrast:** body-text pairs are computed per theme and recorded in each
  spec. Minimum accepted: 4.5:1. A theme that fails is fixed, not shipped.
- **Focus:** every interactive component has a visible `:focus-visible` ring,
  recolored per theme.
- **Motion:** `base.css` kills all animation and transition under
  `prefers-reduced-motion`. Themes add motion; the base takes it away.
- **Responsive:** mobile-first. Single column at 375px; two/three-column
  grids from 720px; sidebar layout from 960px.

## Roadmap

Shipped: cybercore, claymorphism, bento.
Queued next: glassmorphism, swiss, minimalism, neobrutalism, pixel-art,
synthwave, y2k, editorial, luxury, cyberpunk, wabi-sabi, ethereal, bohemian,
victorian, scrapbook, surrealism, maximalism, typography, conceptual-sketch.

## License

Free to use and adapt. Font files follow their Google Fonts (OFL) licenses.
