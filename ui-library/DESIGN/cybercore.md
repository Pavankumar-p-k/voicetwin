# Cybercore — design spec

Dark neon-terminal theme. Grid backdrop, glowing edges, clipped-corner buttons.

## 1. Color tokens

| Token      | Value     | Used for                    |
|------------|-----------|-----------------------------|
| bg         | `#05070f` | page background             |
| surface    | `#0b1126` | cards, nav, sidebar, modal  |
| text       | `#d9fbff` | body text (16.9:1 on surf) |
| muted      | `#93a7cf` | captions, th, secondary nav |
| primary    | `#00f0ff` | buttons, links, focus, bars |
| secondary  | `#ff00e5` | chips, alt borders, glow 2  |
| border     | `#1f5f7a` | hairlines, table rules      |
| success    | `#35e08e` | ok badges                   |
| warning    | `#ffd23f` | warn badges                 |
| error      | `#ff5d7a` | error badges, danger        |

Body text contrast: text/surface 17.1:1, muted/surface 7.7:1, on-primary/primary 13.0:1. All pass 4.5:1.

## 2. Typography scale

| Level   | Font      | Size                          |
|---------|-----------|-------------------------------|
| display | Unbounded | clamp(2rem, 6vw, 3.5rem), uppercase, glow |
| h1      | Unbounded | 1.6rem                        |
| h2      | Unbounded | 1.25rem                       |
| h3      | Unbounded | 1.05rem                       |
| body    | Space Mono| 15px / 1.6                    |
| caption | Space Mono| 12px, uppercase on labels     |
| mono    | Space Mono| code blocks (dark bg, cyan)   |

## 3. Spacing + radius + shadow tokens

- Spacing: sm 8 · md 18 · lg 36 · gap 18 · maxw 1120 · sidebar 230.
- Radius: 6 base / 4 small / 4 pill / 4 avatar (near-sharp, techy).
- Shadow: none by default; glow-only depth — `0 0 12px rgba(0,240,255,.18)` on cards, `0 0 18px` on hover, strong glow on primary buttons and stat values.

## 4. Do / Don't

Do:
1. Keep backgrounds dark so neon stays legible.
2. Use uppercase + letter-spacing on buttons and brand.
3. Reserve magenta for secondary emphasis only (chips, glow edge).
4. Pair glow with a real 1px border so focus order stays visible.
5. Use the grid backdrop sparingly — one layer, low alpha.

Don't:
1. Don't put body copy on pure neon fills.
2. Don't mix in rounded bubbly components.
3. Don't stack multiple glow colors on one element.
4. Don't use the flicker animation on text people must read.
5. Don't drop the mono font for code/data.

## 5. Component notes

- Button: clipped corners (cut-corner polygon), uppercase; primary glows cyan and flickers once on hover; secondary is magenta-outline on dark.
- Card: dark panel, cyan 1px border, outer + inner glow.
- Table: cyan header labels, row hover lifts to surface-2.
- Toggle: cyan glow when on.
- Progress: cyan→magenta gradient fill with glow.
- Tabs: active tab gets surface-2 fill + border.

## 6. Best for / avoid for

Best for: dev tools, dashboards, gaming HUDs, terminal-style apps.
Avoid for: long-form reading, government/health content, low-vision audiences without tweaks.
