/**
 * Component variants: reads cva() variant maps out of source files and turns a
 * Tailwind class string into the colours a variant paints, per theme, at rest
 * and while hovered.
 */

import { splitTop } from "./css.mjs"

/* ------------------------------------------------------------- cva() parsing */

const STRING = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g

function matchBrace(src, open) {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++
    else if (src[i] === "}" && --depth === 0) return i
  }
  return -1
}

/**
 * Every variant of one group (default "variant") in a cva() call:
 * { name: classString } with the cva base classes prepended.
 */
export function parseCva(src, group = "variant") {
  const call = src.search(/\bcva\s*\(/)
  let base = ""
  if (call >= 0) {
    const firstBrace = src.indexOf("{", call)
    const head = src.slice(src.indexOf("(", call) + 1, firstBrace)
    base = [...head.matchAll(STRING)].map((m) => m[2]).join(" ")
  }

  const variantsAt = src.search(/\bvariants\s*:\s*\{/)
  const scope = variantsAt >= 0 ? src.slice(variantsAt) : src
  const groupMatch = scope.match(new RegExp(`(?:^|[\\s,{])["']?${group}["']?\\s*:\\s*\\{`))
  if (!groupMatch) return {}
  const open = scope.indexOf("{", groupMatch.index + groupMatch[0].indexOf(":"))
  const close = matchBrace(scope, open)
  const body = scope.slice(open + 1, close)

  const out = {}
  // key: "…" | key: ["…", "…"] | key: "…" + "…" | "quoted-key": …
  const entry = /(?:["']([\w-]+)["']|([A-Za-z_$][\w$-]*))\s*:\s*((?:\[[^\]]*\])|(?:(["'`])(?:\\.|(?!\4)[^\\])*\4(?:\s*\+\s*(["'`])(?:\\.|(?!\5)[^\\])*\5)*))/g
  for (const m of body.matchAll(entry)) {
    const name = m[1] ?? m[2]
    const classes = [...m[3].matchAll(STRING)].map((s) => s[2]).join(" ")
    out[name] = `${base} ${classes}`.replace(/\s+/g, " ").trim()
  }
  return out
}

/* --------------------------------------------------------- class evaluation */

/** Split "dark:hover:bg-x" into prefixes and utility, respecting [ ] brackets. */
export function splitVariant(cls) {
  const parts = splitTop(cls.replace(/^!|!$/g, ""), ":")
  return { prefixes: parts.slice(0, -1), utility: parts[parts.length - 1] ?? "" }
}

/**
 * Tailwind colour utility fragment -> CSS colour expression, or null if it is
 * not a colour ("sm", "left", "balance" …). `has(name)` says whether a custom
 * property exists in the theme.
 */
export function colorExpr(fragment, has) {
  let base = fragment
  let alpha = null
  const am = fragment.match(/^(.*?)\/(\[[^\]]+\]|[\d.]+)$/)
  if (am && !fragment.startsWith("[")) {
    base = am[1]
    alpha = am[2].startsWith("[") ? am[2].slice(1, -1) : `${am[2]}%`
    if (!String(alpha).endsWith("%")) alpha = `${Number(alpha) * 100}%`
  } else if (am && fragment.startsWith("[") && am[1].endsWith("]")) {
    base = am[1]
    alpha = am[2].startsWith("[") ? am[2].slice(1, -1) : `${am[2]}%`
  }

  let expr = null
  if (base.startsWith("[") && base.endsWith("]")) {
    const inner = base.slice(1, -1).replace(/^color:/, "").replace(/_/g, " ")
    if (/^(#|rgb|hsl|oklch|oklab|var\(|color-mix|light-dark)/i.test(inner)) expr = inner
  } else if (base.startsWith("(") && base.endsWith(")")) {
    expr = `var(${base.slice(1, -1).replace(/^color:/, "")})`
  } else if (["white", "black", "transparent"].includes(base)) {
    expr = base
  } else if (has(`color-${base}`)) {
    expr = `var(--color-${base})`
  } else if (has(base)) {
    expr = `var(--${base})`
  }
  if (!expr) return null
  return alpha ? `color-mix(in oklab, ${expr} ${alpha}, transparent)` : expr
}

const STATE_PREFIXES = new Set(["hover"])

/**
 * What a class string paints in one theme:
 *   { rest: { fill, from, via, to, label, brightness }, hover: { … } }
 * Classes behind any other variant (focus-visible, data-*, aria-*, sm, group-…)
 * are ignored: they describe other states.
 */
export function evaluateClasses(classString, themeName, has) {
  const dark = /dark/i.test(themeName)
  const layers = { rest: [], darkRest: [], hover: [], darkHover: [] }
  for (const cls of classString.split(/\s+/).filter(Boolean)) {
    const { prefixes, utility } = splitVariant(cls)
    const isDark = prefixes.includes("dark")
    const others = prefixes.filter((p) => p !== "dark")
    if (others.some((p) => !STATE_PREFIXES.has(p))) continue
    const hover = others.includes("hover")
    if (isDark && !dark) continue
    layers[hover ? (isDark ? "darkHover" : "hover") : isDark ? "darkRest" : "rest"].push(utility)
  }

  const apply = (state, utilities) => {
    for (const u of utilities) {
      let m
      if (/^bg-(gradient-to|linear|radial|conic)-/.test(u)) state.gradient = true
      else if (u === "bg-none" || u === "bg-transparent") {
        state.fill = "transparent"
        state.gradient = false
      } else if ((m = u.match(/^(from|via|to)-(.+)$/))) {
        const e = colorExpr(m[2], has)
        if (e) state[m[1]] = e
      } else if ((m = u.match(/^bg-(.+)$/))) {
        const e = colorExpr(m[1], has)
        if (e) state.fill = e
      } else if ((m = u.match(/^text-(.+)$/))) {
        const e = colorExpr(m[1], has)
        if (e) state.label = e
      } else if ((m = u.match(/^brightness-\[?([\d.]+)\]?$/))) {
        const n = Number(m[1])
        state.brightness = n > 3 ? n / 100 : n
      }
    }
    return state
  }

  const rest = apply({}, layers.rest)
  if (dark) apply(rest, layers.darkRest)
  const hoverUtilities = [...layers.hover, ...(dark ? layers.darkHover : [])]
  const hover = hoverUtilities.length ? apply({ ...rest, brightness: undefined }, hoverUtilities) : null
  return { rest, hover }
}
