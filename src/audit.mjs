/**
 * Runs the checks of one configuration and returns the result rows.
 *
 * Row: { section, theme, label, fg, bg, ratio, threshold, level, pass, note }
 *   level "error" fails the run, "warn" fails it only with --fail-on warn,
 *   "info" is context and never fails.
 */

import { readFileSync, existsSync } from "node:fs"
import { resolve as resolvePath } from "node:path"
import { brightness, composite, contrast, toHex } from "./color.mjs"
import { buildThemes, collectDeclarations, DEFAULT_THEMES, resolver, UnresolvedError } from "./css.mjs"
import { evaluateClasses, parseCva } from "./variants.mjs"

export const AA_TEXT = 4.5
export const AA_UI = 3

const round = (n) => Math.round(n * 100) / 100

/** "muted-foreground" | "--muted-foreground" | "var(--x)" | "#fff" -> expression */
const expr = (ref) => {
  const s = String(ref).trim()
  if (/^[a-z][\w-]*$/i.test(s) && !["white", "black", "transparent"].includes(s)) return `var(--${s})`
  if (s.startsWith("--")) return `var(${s})`
  return s
}

export function loadThemes(config, cwd) {
  const declarations = []
  if (config.tailwindTheme !== false) {
    const tw = typeof config.tailwindTheme === "string" ? resolvePath(cwd, config.tailwindTheme) : resolvePath(cwd, "node_modules/tailwindcss/theme.css")
    if (existsSync(tw)) {
      for (const d of collectDeclarations(readFileSync(tw, "utf8"), tw)) declarations.push({ ...d, order: d.order - 1e9 })
    }
  }
  let offset = 0
  for (const file of config.css) {
    const path = resolvePath(cwd, file)
    const found = collectDeclarations(readFileSync(path, "utf8"), file)
    for (const d of found) declarations.push({ ...d, order: d.order + offset })
    offset += found.length + 1
  }
  const tokens = buildThemes(declarations, config.themes ?? DEFAULT_THEMES)
  return Object.fromEntries(Object.entries(tokens).map(([name, t]) => [name, resolver(t, name)]))
}

export function runAudit(config, cwd = process.cwd()) {
  const themes = loadThemes(config, cwd)
  const rows = []
  const skipped = []
  const seen = new Set()
  const canvasRef = expr(config.canvas ?? "background")
  const ignore = (config.ignore ?? []).map((p) => (p instanceof RegExp ? p : new RegExp(String(p).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))))

  for (const [theme, r] of Object.entries(themes)) {
    const white = { r: 255, g: 255, b: 255, a: 1 }
    const canvas = (() => {
      try {
        return r.solid(canvasRef, white)
      } catch {
        return /dark/i.test(theme) ? { r: 0, g: 0, b: 0, a: 1 } : white
      }
    })()

    const record = (row) => {
      const key = `${row.section}|${theme}|${row.label}`
      if (seen.has(key)) return
      seen.add(key)
      if (ignore.some((re) => re.test(`${theme} ${row.label}`))) return
      const ratio = round(contrast(row.fgColor, row.bgColor))
      const level = row.level ?? "error"
      rows.push({
        section: row.section,
        theme,
        label: row.label,
        fg: toHex(row.fgColor),
        bg: toHex(row.bgColor),
        ratio,
        threshold: row.threshold,
        level,
        pass: level === "info" || ratio >= row.threshold - 0.005,
        note: row.note,
      })
    }

    const tryPair = (section, label, fgRef, bgRef, opts = {}) => {
      try {
        const bg = r.solid(expr(bgRef), opts.backdrop ?? canvas)
        let fg = r.solid(expr(fgRef), bg)
        let bgc = bg
        if (opts.brightness) {
          fg = brightness(fg, opts.brightness)
          bgc = brightness(bg, opts.brightness)
        }
        record({ section, label, fgColor: fg, bgColor: bgc, threshold: opts.threshold ?? AA_TEXT, level: opts.level, note: opts.note })
      } catch (error) {
        if (!(error instanceof UnresolvedError)) throw error
        if (opts.optional) return
        skipped.push({ section, theme, label, reason: error.message })
      }
    }

    /* 1. tokens: every X-foreground on X, then the configured ink x surface matrix */
    if (config.autoForeground !== false) {
      for (const name of Object.keys(r.tokens)) {
        if (!name.endsWith("-foreground") || name.startsWith("color-")) continue
        const fill = name.slice(0, -"-foreground".length)
        if (!r.has(fill)) continue
        tryPair("tokens", `${name} on ${fill}`, name, fill, { optional: true })
      }
    }
    for (const m of config.matrix ?? []) {
      if (m.themes && !m.themes.includes(theme)) continue
      for (const ink of m.inks) {
        if (/^[a-z][\w-]*$/i.test(ink) && !r.has(ink)) continue
        for (const surface of m.surfaces) {
          if (/^[a-z][\w-]*$/i.test(surface) && !r.has(surface)) continue
          tryPair(m.section ?? "tokens", `${ink} on ${surface}`, ink, surface, m)
        }
      }
    }

    /* 2. explicit pairs (a config may build these with loops) */
    for (const p of config.pairs ?? []) {
      if (p.themes && !p.themes.includes(theme)) continue
      const k = typeof p.brightness === "object" ? p.brightness?.[theme] : p.brightness
      tryPair(p.section ?? "pairs", p.label ?? `${p.fg} on ${p.bg}`, p.fg, p.bg, { ...p, brightness: k })
    }

    /* 3. component variants */
    for (const c of config.components ?? []) {
      const path = resolvePath(cwd, c.file)
      if (!existsSync(path)) {
        skipped.push({ section: "components", theme, label: c.file, reason: "file not found" })
        continue
      }
      const variants = parseCva(readFileSync(path, "utf8"), c.group ?? "variant")
      const name = c.name ?? c.file.split(/[\\/]/).pop().replace(/\.[jt]sx?$/, "")
      const unders = c.under ?? ["background", "card"]
      for (const under of unders) {
        if (/^[a-z][\w-]*$/i.test(under) && !r.has(under)) continue
        let page
        try {
          page = r.solid(expr(under), canvas)
        } catch {
          continue
        }
        for (const [variant, classes] of Object.entries(variants)) {
          if (c.skip?.includes(variant)) continue
          const { rest, hover } = evaluateClasses(classes, theme, r.has)
          const defaultLabel = expr(c.defaultText ?? config.defaultText ?? "foreground")
          const check = (state, when) => {
            const stops = state.gradient && state.from && state.to ? [["from", state.from], ["via", state.via], ["to", state.to]].filter(([, v]) => v) : [["", state.fill ?? "transparent"]]
            for (const [stop, fillExpr] of stops) {
              const label = `${name} ${variant}${stop ? ` ${stop}` : ""} ${when} on ${under}`
              try {
                let fill = composite(r.resolve(fillExpr), page)
                let ink = composite(r.resolve(state.label ?? defaultLabel), fill)
                if (state.brightness) {
                  fill = brightness(fill, state.brightness)
                  ink = brightness(ink, state.brightness)
                }
                record({ section: "components", label, fgColor: ink, bgColor: fill, threshold: c.threshold ?? AA_TEXT, level: c.level, note: fillExpr.includes("transparent)") ? "translucent fill composites against the surface behind it" : undefined })
              } catch (error) {
                if (!(error instanceof UnresolvedError)) throw error
                skipped.push({ section: "components", theme, label, reason: error.message })
              }
            }
          }
          check(rest, "@rest")
          if (hover) check(hover, "@hover")
        }
      }
    }

    /* 4. UI boundaries (WCAG 1.4.11): borders and focus rings at 3:1 */
    for (const u of config.ui ?? []) {
      if (/^[a-z][\w-]*$/i.test(u.fg) && !r.has(u.fg)) continue
      for (const surface of u.on) {
        if (/^[a-z][\w-]*$/i.test(surface) && !r.has(surface)) continue
        tryPair("ui", u.label ? `${u.label} on ${surface}` : `${u.fg} on ${surface}`, u.fg, surface, { threshold: AA_UI, level: "warn", ...u })
      }
    }
  }

  return { rows, skipped, themes: Object.keys(themes) }
}
