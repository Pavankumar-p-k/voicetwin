# Bento — design spec

Quiet modular-grid theme. Off-white canvas, white tiles, hairline borders, Inter only, motion kept near-zero.

## 1. Color tokens

| Token      | Value     | Used for                    |
|------------|-----------|-----------------------------|
| bg         | `#f2f2ef` | page canvas                 |
| surface    | `#ffffff` | tiles, nav, modal           |
| text       | `#171713` | body text (15.9:1 on white) |
| muted      | `#5c5c55` | captions, th (7.0:1)        |
| primary    | `#171713` | main buttons (ink tiles)    |
| secondary  | `#2b5fe8` | links, accents (5.4:1 pair) |
| border     | `#e3e3dc` | hairlines, tile edges       |
| success    | `#1e8e5a` | ok badges                   |
| warning    | `#96690a` | warn badges                 |
| error      | `#cf3d3d` | error badges                |

Body text contrast: text/surface 15.9:1, muted/surface 7.0:1, on-primary(white)/primary 15.9:1, on-secondary(white)/secondary 5.4:1. All pass 4.5:1.

## 2. Typography scale

| Level   | Font  | Size                           |
|---------|-------|--------------------------------|
| display | Inter 800 | clamp(2rem, 5vw, 3.2rem), -0.03em |
| h1      | Inter | 1.5rem, -0.02em                |
| h2      | Inter | 1.2rem                         |
| h3      | Inter | 1rem                           |
| body    | Inter | 14.5px / 1.6                   |
| caption | Inter | 12px, uppercase on labels      |
| mono    | system mono | code (ink tile, paper text) |

## 3. Spacing + radius + shadow tokens

- Spacing: sm 8 · md 20 · lg 40 · gap 14 (tight tile rhythm).
- Radius: 20 tiles / 12 controls / 999 pills.
- Shadow: `0 1px 2px rgba(23,23,19,.05)` resting; hover `0 8px 24px rgba(23,23,19,.09)`. Depth is quiet on purpose.

## 4. Do / Don't

Do:
1. Compose pages as tile grids with one 14px rhythm.
2. Left-align hero copy — bento is product-ui, not posters.
3. Use ink-black primary buttons as the single bold note.
4. Keep one blue accent for links and active states only.
5. Let whitespace do the grouping; avoid extra dividers.

Don't:
1. Don't add glows, gradients, or brand-color washes.
2. Don't center everything — left edge is the grid spine.
3. Don't use more than two font weights per view.
4. Don't round tiles below 16px.
5. Don't animate beyond lift + fade.

## 5. Component notes

- Button: ink tile (primary) or white hairline tile (secondary); secondary gains an ink border on hover.
- Card/stat tile: white, hairline border, gains soft shadow on hover.
- Table: white tile, header row unfilled, row hover paper-tint.
- Toggle: flips to full ink when on.
- Tabs: active tab is an ink pill with white text.
- Code block: inverted ink tile with paper text.

## 6. Best for / avoid for

Best for: marketing pages, SaaS dashboards, portfolios, app home screens.
Avoid for: brand-heavy expressive sites, horror/dark-first experiences.
