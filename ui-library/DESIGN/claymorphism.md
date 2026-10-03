# Claymorphism — design spec

Soft pastel clay theme. Everything looks squeezable: dual soft shadows, no visible borders, big radii, bouncy motion.

## 1. Color tokens

| Token      | Value     | Used for                       |
|------------|-----------|--------------------------------|
| bg         | `#e0e5ec` | page + card fill (same clay)   |
| surface    | `#e0e5ec` | cards, nav, modal              |
| text       | `#3b4160` | body text (7.3:1 on bg)        |
| muted      | `#5d6484` | captions, placeholders (4.6:1) |
| primary    | `#7ba4ff` | buttons, fills (dark ink text) |
| secondary  | `#ff9db1` | accents, alt fills             |
| border     | `#e0e5ec` | unused (border-w: 0)           |
| success    | `#2fa36b` | ok badges (white text)         |
| warning    | `#9a6a00` | warn badges (white text)       |
| error      | `#d33f4e` | error badges (white text)      |

Body text contrast: text/bg 7.9:1, muted/bg 4.6:1, on-primary(#0a1633)/primary 7.3:1. All pass 4.5:1. (Primary buttons use dark ink, not white, on purpose.)

## 2. Typography scale

| Level   | Font         | Size                           |
|---------|--------------|--------------------------------|
| display | Archivo 800  | clamp(2.2rem, 6vw, 3.8rem)     |
| h1      | Archivo      | 1.7rem                         |
| h2      | Archivo      | 1.3rem                         |
| h3      | Archivo      | 1.1rem                         |
| body    | Space Grotesk| 15px / 1.6                     |
| caption | Space Grotesk| 12.5px, uppercase on labels    |
| mono    | system mono  | code (clay-dark bg)             |

## 3. Spacing + radius + shadow tokens

- Spacing: sm 10 · md 22 · lg 44 · gap 22 (roomy, airy).
- Radius: 26 base / 18 small / 999 pill (very round).
- Shadow: dual-source clay — `8px 8px 16px #a3b1c6, -8px -8px 16px #fff`; pressed state uses matching inset shadows. No borders anywhere.

## 4. Do / Don't

Do:
1. Keep the light source consistent (top-left highlight).
2. Use inset shadows for pressed/active/selected states.
3. Give touch targets extra padding — clay reads as tactile.
4. Pair blue primary fills with the pink secondary sparingly.
5. Use dark ink text on all colored fills.

Don't:
1. Don't add hard borders or 1px hairlines.
2. Don't use pure black text — the slate keeps it soft.
3. Don't shrink radii below 16px on cards.
4. Don't use white text on the light-blue primary (fails contrast).
5. Don't use clay for dense data grids — softness kills scannability.

## 5. Component notes

- Button: chunky rounded, dual soft shadow; hover lifts with spring; active presses inward (inset shadow).
- Card: same clay as bg, distinguished by shadow only.
- Input: inset-pressed look, reads as "carved in".
- Toggle: inset track, clay knob with drop shadow.
- Progress: inset groove with blue→pink gradient fill.
- Tabs: active tab is pressed-in, not outlined.

## 6. Best for / avoid for

Best for: mobile apps, kids/education products, friendly onboarding, wellness apps.
Avoid for: dense data tables, professional/finance contexts, high-glare outdoor use.
