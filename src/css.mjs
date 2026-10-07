/**
 * Reads custom properties out of CSS and resolves colour expressions per theme.
 *
 * A theme is the list of selectors whose declarations apply to it, in source
 * order. Tailwind `@theme` blocks (and Tailwind's own theme.css, when found)
 * form the lowest layer of every theme. `@media (prefers-color-scheme: dark)`
 * wrapped rules count towards the dark theme.
 */

import { composite, mix, parseColor, TRANSPARENT } from "./color.mjs"

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "")

/** Walk the stylesheet and return every custom property with its context. */
export function collectDeclarations(cssText, source = "") {
  const css = stripComments(cssText)
  const out = []
  let order = 0

  function walk(text, ctx) {
    let i = 0
    let start = 0
    let flat = ""
    while (i < text.length) {
      const ch = text[i]
      if (ch === "{") {
        const prelude = text.slice(start, i).trim()
        let depth = 1
        let j = i + 1
        for (; j < text.length && depth > 0; j++) {
          if (text[j] === "{") depth++
          else if (text[j] === "}") depth--
        }
        const body = text.slice(i + 1, j - 1)
        walk(body, nextContext(ctx, prelude))
        i = j
        start = i
        continue
      }
      if (ch === ";" || ch === "}") {
        flat += text.slice(start, i + 1)
        start = i + 1
      }
      i++
    }
    flat += text.slice(start)
    if (!ctx.selectors && !ctx.theme) return
    for (const [, name, value] of flat.matchAll(/--([\w-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g)) {
      out.push({ name, value: value.trim(), selectors: ctx.selectors, theme: ctx.theme, darkMedia: ctx.darkMedia, order: order++, source })
    }
  }

  walk(css, { selectors: null, theme: false, darkMedia: false })
  return out
}

function nextContext(ctx, prelude) {
  if (prelude.startsWith("@theme")) return { ...ctx, theme: true, selectors: null }
  if (prelude.startsWith("@media")) return { ...ctx, darkMedia: ctx.darkMedia || /prefers-color-scheme\s*:\s*dark/.test(prelude) }
  if (prelude.startsWith("@")) return ctx // @layer, @supports, @container …
  const selectors = splitTop(prelude).map(normalizeSelector)
  return { ...ctx, theme: false, selectors }
}

export const normalizeSelector = (s) => s.replace(/\s+/g, " ").replace(/["']/g, "").replace(/\s*([>+~])\s*/g, "$1").trim()

export const DEFAULT_THEMES = {
  light: [":root", "html", ":host", ".light", ":root.light", "html.light", "[data-theme=light]", ":root[data-theme=light]", "html[data-theme=light]"],
  dark: [
    ":root",
    "html",
    ":host",
    ".dark",
    ":root.dark",
    "html.dark",
    ".dark-theme",
    "[data-theme=dark]",
    ":root[data-theme=dark]",
    "html[data-theme=dark]",
    "[data-mode=dark]",
    "@dark",
  ],
}

/**
 * Build the token map of each theme.
 * `themes` maps a theme name to its selectors (normalised, see DEFAULT_THEMES);
 * "@dark" stands for any selector inside a prefers-color-scheme: dark query.
 */
export function buildThemes(declarations, themes = DEFAULT_THEMES) {
  const ordered = [...declarations].sort((a, b) => a.order - b.order)
  const result = {}
  for (const [name, selectorList] of Object.entries(themes)) {
    const wanted = new Set(selectorList.map(normalizeSelector))
    const wantsDarkMedia = wanted.has("@dark")
    const tokens = {}
    for (const d of ordered) if (d.theme) tokens[d.name] = d.value
    for (const d of ordered) {
      if (d.theme || !d.selectors) continue
      if (d.darkMedia && !wantsDarkMedia) continue
      if (d.selectors.some((s) => wanted.has(s))) tokens[d.name] = d.value
    }
    result[name] = tokens
  }
  return result
}

/* ------------------------------------------------------------------ resolving */

/** Split on top-level commas (not inside parentheses). */
export function splitTop(s, sep = ",") {
  const out = []
  let depth = 0
  let cur = ""
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++
    if (ch === ")" || ch === "]") depth--
    if (ch === sep && depth === 0) {
      out.push(cur.trim())
      cur = ""
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

const fnCall = (s, name) => {
  const prefix = `${name}(`
  if (!s.toLowerCase().startsWith(prefix) || !s.endsWith(")")) return null
  let depth = 0
  for (let i = name.length; i < s.length; i++) {
    if (s[i] === "(") depth++
    else if (s[i] === ")" && --depth === 0) return i === s.length - 1 ? s.slice(prefix.length, -1) : null
  }
  return null
}

export class UnresolvedError extends Error {}

/**
 * A resolver for one theme. `resolve(expr)` returns { r, g, b, a } or throws
 * UnresolvedError. Understands var() with fallbacks, light-dark(), color-mix()
 * and every literal parseColor() knows, including vars nested inside hsl().
 */
export function resolver(tokens, themeName) {
  const isDark = /dark/i.test(themeName)

  function resolve(expr, depth = 0) {
    if (depth > 24) throw new UnresolvedError(`too deeply nested: ${expr}`)
    const s = String(expr).trim().replace(/\s*!important$/, "")

    const v = fnCall(s, "var")
    if (v != null) {
      const [ref, ...fallback] = splitTop(v)
      const name = ref.replace(/^--/, "")
      if (tokens[name] != null) return resolve(tokens[name], depth + 1)
      if (fallback.length) return resolve(fallback.join(","), depth + 1)
      throw new UnresolvedError(`unknown token --${name}`)
    }

    const ld = fnCall(s, "light-dark")
    if (ld != null) {
      const [light, dark] = splitTop(ld)
      return resolve(isDark ? dark : light, depth + 1)
    }

    const cm = fnCall(s, "color-mix")
    if (cm != null) {
      const [method, ...rest] = splitTop(cm)
      const space = method.replace(/^in\s+/i, "").split(/\s+/)[0].toLowerCase()
      const [aExpr, aPct] = splitPct(rest[0])
      const [bExpr, bPct] = splitPct(rest[1])
      const a = resolve(aExpr, depth + 1)
      const b = resolve(bExpr, depth + 1)
      let p1 = aPct ?? (bPct != null ? 100 - bPct : 50)
      let p2 = bPct ?? 100 - p1
      const sum = p1 + p2
      const out = mix(a, b, p1 / sum, space)
      return sum < 100 ? { ...out, a: out.a * (sum / 100) } : out
    }

    const literal = parseColor(s)
    if (literal) return literal

    // var() nested inside a colour function: hsl(var(--primary)), rgb(var(--x) / 0.5)
    if (s.includes("var(")) {
      const expanded = s.replace(/var\(\s*--([\w-]+)\s*(?:,([^()]*))?\)/g, (_, name, fb) => {
        if (tokens[name] != null) return tokens[name]
        if (fb != null) return fb.trim()
        throw new UnresolvedError(`unknown token --${name}`)
      })
      if (expanded !== s) return resolve(expanded, depth + 1)
    }
    throw new UnresolvedError(`cannot resolve colour: ${s}`)
  }

  /** Resolve and flatten onto an opaque backdrop (alpha colours sit on something). */
  function solid(expr, backdrop) {
    const c = typeof expr === "string" ? resolve(expr) : expr
    if (c.a >= 1) return c
    const under = typeof backdrop === "string" ? solid(backdrop, { r: 255, g: 255, b: 255, a: 1 }) : backdrop
    return composite(c, under)
  }

  const has = (name) => tokens[name.replace(/^--/, "")] != null

  return { resolve, solid, has, tokens, transparent: TRANSPARENT }
}

const splitPct = (part) => {
  const m = String(part).match(/^(.*?)\s+([\d.]+)%$/) ?? String(part).match(/^([\d.]+)%\s+(.*)$/)
  if (!m) return [part, null]
  return /^[\d.]+$/.test(m[1]) ? [m[2], Number(m[1])] : [m[1], Number(m[2])]
}
