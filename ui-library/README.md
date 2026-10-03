# ui-library

Reusable static UI theme library. No frameworks, no build step — plain HTML + CSS.

## Use

```html
<link rel="stylesheet" href="base.css">
<link rel="stylesheet" href="themes/<id>.css">
```

`base.css` owns all layout and component structure using CSS variables only.
Each `themes/<id>.css` sets the tokens (colors, fonts, radius, shadows, motion).
Swap the theme file to reskin every component. No JS needed for themes.

## Files

| Path              | What                                          |
|-------------------|-----------------------------------------------|
| `base.css`        | all components, variables only                |
| `themes/*.css`    | one file per theme: tokens + theme effects    |
| `styles.json`     | id, name, tags, best_for, avoid_for, fonts    |
| `DESIGN/<id>.md`  | per-theme spec: tokens, type, rules, notes    |
| `demo.html`       | live switcher over every component            |

## Components (identical classes in every theme)

`.btn` (.primary/.secondary/.ghost/.icon) · `.card` · `.nav` · `.sidebar` ·
`.table` · `.input` · `.select` · `.toggle` · `.badge` (.ok/.warn/.err) · `.chip` ·
`.modal` · `.tabs` · `.accordion` · `.tooltip` via `[data-tip]` · `.stat-card` ·
`.progress` · `.avatar` (.sm/.lg) · `.code-block` · `.hero` · `.footer`

Layout helpers: `.container` · `.grid` (.cols-2/.cols-3) · `.layout` (sidebar+main) ·
`.row` · `.stack` · `.muted` · `.caption`.

JS-free patterns: modal = hidden checkbox + label, tabs = radios, accordion = `<details>`.

## Rules followed

- Original CSS, no copied code.
- Body-text contrast ≥ 4.5:1 in every theme (verified, see DESIGN specs).
- Mobile-first; 375px single column, multi-column from 720/960px.
- `prefers-reduced-motion` disables all motion globally.
