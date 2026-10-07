import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { contrast, mix, parseColor, toHex, TRANSPARENT } from "../src/color.mjs"
import { buildThemes, collectDeclarations, resolver } from "../src/css.mjs"
import { colorExpr, evaluateClasses, parseCva } from "../src/variants.mjs"
import { runAudit } from "../src/audit.mjs"
import { DEFAULTS } from "../src/config.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name) => join(here, "fixtures", name)
const cli = join(here, "..", "bin", "wunderui-contrast.mjs")

test("parses every colour syntax a design system uses", () => {
  assert.equal(toHex(parseColor("oklch(0.628 0.2577 29.23)")), "#ff0000")
  assert.equal(toHex(parseColor("oklch(62.8% 0.2577 29.23deg)")), "#ff0000")
  assert.equal(toHex(parseColor("oklch(0.205 0 0)")), "#171717")
  assert.equal(toHex(parseColor("hsl(222.2 47.4% 11.2%)")), "#0f172a")
  assert.equal(toHex(parseColor("222.2 47.4% 11.2%")), "#0f172a") // shadcn v3 triplet
  assert.equal(toHex(parseColor("hsl(0, 100%, 50%)")), "#ff0000")
  assert.equal(toHex(parseColor("#5A5EF4")), "#5a5ef4")
  assert.equal(toHex(parseColor("#fff")), "#ffffff")
  assert.equal(parseColor("rgb(10 20 30 / 50%)").a, 0.5)
  assert.equal(parseColor("oklch(1 0 0 / 10%)").a, 0.1)
  assert.equal(parseColor("var(--x)"), null)
  assert.equal(parseColor("1rem"), null)
})

test("WCAG ratio", () => {
  assert.equal(Math.round(contrast(parseColor("#fff"), parseColor("#000")) * 100) / 100, 21)
  assert.equal(Math.round(contrast(parseColor("#777"), parseColor("#fff")) * 100) / 100, 4.48)
})

test("color-mix with transparent is an alpha, as Tailwind's /90 modifier", () => {
  const m = mix(parseColor("#ff0000"), TRANSPARENT, 0.9, "oklab")
  assert.equal(toHex(m), "#ff0000")
  assert.ok(Math.abs(m.a - 0.9) < 1e-9)
})

test("themes: :root, .dark, @media dark, @theme aliases, nested var() in hsl()", () => {
  const css = `
    @theme inline { --color-primary: var(--primary); }
    @layer base {
      :root, .light { --primary: 222.2 47.4% 11.2%; --link: var(--brand, #00f); }
      .dark { --primary: 210 40% 98%; }
    }
    @media (prefers-color-scheme: dark) { :root { --surface: #111; } }
    :root { --surface: #fff; --ink: hsl(var(--primary)); }
  `
  const themes = buildThemes(collectDeclarations(css))
  const light = resolver(themes.light, "light")
  const dark = resolver(themes.dark, "dark")
  assert.equal(toHex(light.resolve("var(--color-primary)")), "#0f172a")
  assert.equal(toHex(dark.resolve("var(--color-primary)")), "#f8fafc")
  assert.equal(toHex(light.resolve("var(--ink)")), "#0f172a")
  assert.equal(toHex(light.resolve("var(--link)")), "#0000ff")
  assert.equal(toHex(light.resolve("var(--surface)")), "#ffffff")
  // the later :root rule wins over the dark media query in source order
  assert.equal(toHex(dark.resolve("var(--surface)")), "#ffffff")
  assert.equal(toHex(light.resolve("light-dark(#000, #fff)")), "#000000")
  assert.equal(toHex(dark.resolve("light-dark(#000, #fff)")), "#ffffff")
})

test("cva: base classes, quoted keys, arrays, other groups ignored", () => {
  const src = `cva("text-foreground rounded", { variants: { variant: { default: "bg-primary", "muted-link": ["text-muted", "hover:text-fg"] }, size: { sm: "h-8" } } })`
  const v = parseCva(src)
  assert.deepEqual(Object.keys(v), ["default", "muted-link"])
  assert.equal(v.default, "text-foreground rounded bg-primary")
  assert.equal(v["muted-link"], "text-foreground rounded text-muted hover:text-fg")
})

test("class evaluation: dark overrides, hover layers, other states ignored", () => {
  const has = (n) => ["color-primary", "color-destructive", "color-input", "color-accent"].includes(n)
  const classes = "bg-destructive/10 text-destructive hover:bg-destructive/20 dark:bg-destructive/20 focus-visible:bg-accent data-[x]:bg-input"
  const light = evaluateClasses(classes, "light", has)
  const dark = evaluateClasses(classes, "dark", has)
  assert.equal(light.rest.fill, "color-mix(in oklab, var(--color-destructive) 10%, transparent)")
  assert.equal(dark.rest.fill, "color-mix(in oklab, var(--color-destructive) 20%, transparent)")
  assert.equal(light.hover.fill, "color-mix(in oklab, var(--color-destructive) 20%, transparent)")
  assert.equal(light.rest.label, "var(--color-destructive)")
  assert.equal(colorExpr("sm", has), null)
  assert.equal(colorExpr("[#fff]/50", has), "color-mix(in oklab, #fff 50%, transparent)")
  assert.equal(colorExpr("(--brand)", has), "var(--brand)")
})

test("shadcn v4 fixture: finds the tinted destructive button and muted text", () => {
  const { rows, skipped } = runAudit({ ...DEFAULTS, css: ["app/globals.css"], components: [{ file: "components/ui/button.tsx", name: "button" }] }, fixture("shadcn-v4"))
  assert.equal(skipped.length, 0)
  const fail = (label, theme = "light") => rows.find((r) => r.label === label && r.theme === theme)
  assert.equal(fail("button destructive @rest on background").ratio, 3.99)
  assert.equal(fail("button destructive @rest on background").pass, false)
  assert.equal(fail("muted-foreground on muted").ratio, 4.34)
  assert.equal(fail("button default @rest on background").pass, true)
  assert.equal(fail("input border on background").level, "warn")
  // dark:bg-input/30: 30 % of a 15 %-white token = 4.5 % white over #0a0a0a
  assert.equal(fail("button outline @rest on background", "dark").bg, "#151515")
})

test("CLI: zero-config in a shadcn project, exit codes, formats", () => {
  const run = (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" })
  const v4 = run(fixture("shadcn-v4"))
  assert.equal(v4.status, 1)
  assert.match(v4.stdout, /button destructive @rest on background/)
  const json = JSON.parse(run(fixture("shadcn-v4"), "--json").stdout)
  assert.equal(json.failing, 7)
  assert.equal(json.warnings, 6)
  assert.equal(run(fixture("shadcn-v4"), "--md").stdout.split("\n")[0], "### ❌ Contrast: 7 of 80 checks fail")
  const v3 = JSON.parse(run(fixture("shadcn-v3"), "--json", "--all").stdout)
  assert.ok(v3.results.some((r) => r.label === "primary-foreground on primary" && r.ratio === 17.04))
  assert.equal(run(fixture("shadcn-v4"), "--bogus").status, 2)
  assert.equal(run(here).status, 2) // no stylesheet found
})
