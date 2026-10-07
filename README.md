# WunderUI Contrast

**A WCAG contrast audit for design tokens and Tailwind component variants.** Light and dark, at rest and on hover, with oklch colours and translucent fills, resolved the way the browser resolves them.

```bash
npx wunderui-contrast
```

Run it in a shadcn/ui project and it works without a config. It reads your `globals.css` and your `button.tsx` / `badge.tsx` variant maps, then checks every pair your components actually paint:

```text
=== tokens: 24 checked, 1 below threshold ===
  [FAIL] light muted-foreground on muted          4.34:1  #737373 on #f5f5f5  (needs 4.5:1)

=== components: 48 checked, 6 below threshold ===
  [FAIL] light button destructive @hover on background  3.31:1  #e7000b on #faccce  (needs 4.5:1)
         translucent fill composites against the surface behind it
  [FAIL] light button destructive @rest on background   3.99:1  #e7000b on #fde5e7  (needs 4.5:1)
         translucent fill composites against the surface behind it
…
7 of 80 checks fail, 6 warnings.
```

Exit code `1` when a check fails, so it can gate CI. No dependencies.

## Why another contrast checker

Most checkers compare two hex values you type in. Design systems fail somewhere else:

- **Translucent fills.** `bg-destructive/10` or `hover:bg-primary/90` is a colour mixed with *whatever sits behind the button*. On a white page that makes the fill lighter and the contrast worse. The audit composites every translucent fill against the real surface, the page and the card.
- **Hover states.** `hover:bg-*`, `hover:text-*` and `hover:brightness-*` are evaluated, not just the resting state.
- **Dark mode.** `dark:` classes override the light ones, and `.dark`, `[data-theme=dark]` and `prefers-color-scheme: dark` blocks override the tokens. Both themes are checked.
- **Token chains.** `--color-primary: var(--primary)`, `--text-link: var(--brand-600)`, `light-dark()`, `color-mix()`, `hsl(var(--x))`: everything is resolved down to the colour the user sees.
- **Gradients** fail at their lightest stop, so every stop is checked.
- **Modern colour syntax.** oklch, oklab, hsl, rgb, hex, and shadcn v3's bare `222.2 47.4% 11.2%` triplets. Wide-gamut oklch values are clipped to sRGB, as browsers do on an sRGB display.

## What it checks

| Section | Pairs | Threshold |
| --- | --- | --- |
| `tokens` | every `X-foreground` on `X`, plus an ink × surface matrix (`foreground` and `muted-foreground` on your surfaces by default) | 4.5:1 (WCAG 1.4.3) |
| `components` | every variant of every `cva()` map, text on fill, at rest and on hover, on each surface | 4.5:1 |
| `ui` | input borders and focus rings on your surfaces | 3:1 (WCAG 1.4.11), reported as warnings |
| `pairs` | anything you list in the config | 4.5:1 or your own |

Tokens that don't exist in your theme are skipped, not failed.

## Options

```text
--config <file>     contrast.config.mjs|js|json (default: found in the current folder)
--css <file>        stylesheet with the tokens (repeatable; default: auto-detected)
--component <file>  file with a cva() variant map (repeatable)
--all               list every check, not only the failures
--json              machine-readable output
--md                Markdown, for $GITHUB_STEP_SUMMARY or a PR comment
--fail-on <level>   error (default) or warn
--cwd <dir>         project root
```

Auto-detected stylesheets: `app/globals.css`, `src/app/globals.css`, `styles/globals.css`, `src/index.css`, `src/styles.css` and a few more. Auto-detected components: `components/ui/button.tsx` and `components/ui/badge.tsx` (with or without `src/`). Tailwind's own palette is read from `node_modules/tailwindcss/theme.css` when it is installed, so `text-red-600` resolves too.

## Configuration

`contrast.config.mjs` in the project root. Every key is optional.

```js
export default {
  css: ["src/styles/tokens.css"],
  // which selectors make up each theme (defaults cover :root, .dark, [data-theme=…], prefers-color-scheme)
  themes: { light: [":root"], dark: [":root", ".dark"] },
  // ink x surface matrix
  matrix: [{ inks: ["foreground", "text-secondary", "text-link"], surfaces: ["background", "card", "muted"] }],
  // any pair, with any colour expression
  pairs: [{ fg: "tint-text-blue", bg: "tint-blue", label: "blue badge" }],
  // cva() variant maps and the surfaces they sit on
  components: [{ file: "src/ui/button.tsx", name: "button", under: ["background", "card"], skip: ["link"] }],
  // UI boundaries at 3:1; level "error" makes them fail the run
  ui: [{ fg: "input", on: ["background"], label: "input border", level: "error" }],
  ignore: ["dark button ghost"],
}
```

The config is a module, so pairs can be generated with loops from your component's own data. [`examples/wunderui.config.mjs`](examples/wunderui.config.mjs) is the configuration of the [WunderUI](https://wunderui.com) design system, with 440 checks including a 12-colour × 6-style badge matrix whose hover filter is read from the component source.

## GitHub Action

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with:
    node-version: 22
- uses: Kl-webmedia/wunderui-contrast@v1
  with:
    args: --fail-on error
```

The report lands in the job summary.

## API

```js
import { loadConfig, runAudit, toMarkdown } from "wunderui-contrast"

const { config } = await loadConfig(process.cwd())
const result = runAudit(config)
console.log(toMarkdown(result))
```

## Limits

- Colours are read from CSS custom properties and Tailwind utility classes. Inline styles, CSS-in-JS and images behind text are out of scope; use a browser-based audit for rendered pages.
- WCAG 2.x contrast ratios. APCA is not implemented.
- Variant maps are read from `cva()` calls. Other variant libraries need explicit `pairs`.

## Licence

MIT. Built for and used by [WunderUI](https://wunderui.com), the design system with a matching React library and Figma file.
