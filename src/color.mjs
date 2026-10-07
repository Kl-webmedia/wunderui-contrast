/**
 * Colour parsing, conversion and the WCAG maths.
 *
 * Every colour is { r, g, b, a } with r/g/b as sRGB channels 0–255 (floats, not
 * rounded) and a as 0–1. Wide-gamut values (oklch outside sRGB) are clipped per
 * channel in linear light, which is what browsers do on an sRGB display today.
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export const rgba = (r, g, b, a = 1) => ({ r, g, b, a })
export const TRANSPARENT = rgba(0, 0, 0, 0)

const NAMED = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
}

/* ------------------------------------------------------------ sRGB <-> linear */

const toLinear = (c) => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}
const fromLinear = (v) => {
  const c = clamp(v, 0, 1)
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
}

/* --------------------------------------------------------------- OKLab / OKLCH */

export function oklabToRgb(L, A, B, alpha = 1) {
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B
  const s_ = L - 0.0894841775 * A - 1.291485548 * B
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  return rgba(
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    alpha
  )
}

export function rgbToOklab({ r, g, b }) {
  const lr = toLinear(r)
  const lg = toLinear(g)
  const lb = toLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

export function hslToRgb(h, s, l, a = 1) {
  const hue = ((h % 360) + 360) % 360
  const k = (n) => (n + hue / 30) % 12
  const f = (n) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return rgba(255 * f(0), 255 * f(8), 255 * f(4), a)
}

/* --------------------------------------------------------------------- parsing */

const num = (s) => Number.parseFloat(s)

/** "50%" -> 0.5, "0.5" -> 0.5, "none" -> 0 */
const unit = (s, percentOf = 1) => {
  if (s == null) return null
  const t = String(s).trim()
  if (t === "none") return 0
  return t.endsWith("%") ? (num(t) / 100) * percentOf : num(t)
}

const hue = (s) => {
  const t = String(s).trim()
  if (t === "none") return 0
  if (t.endsWith("turn")) return num(t) * 360
  if (t.endsWith("rad")) return (num(t) * 180) / Math.PI
  if (t.endsWith("grad")) return num(t) * 0.9
  return num(t)
}

/** The arguments of rgb(), hsl(), oklch() … in either the comma or the space syntax. */
function args(inner) {
  const [main, slash] = inner.split("/")
  const parts = main.includes(",") ? main.split(",").map((p) => p.trim()) : main.trim().split(/\s+/)
  let alpha = slash != null ? slash.trim() : null
  if (alpha == null && parts.length === 4) alpha = parts.pop()
  return { parts, alpha: alpha == null ? 1 : clamp(unit(alpha), 0, 1) }
}

function hexToRgb(hex) {
  let h = hex.slice(1)
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("")
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return null
  const n = (i) => parseInt(h.slice(i, i + 2), 16)
  return rgba(n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1)
}

/**
 * Parse one CSS colour literal. Returns null when the string is not a colour
 * this module understands (a var(), a keyword like currentColor, a size …).
 *
 * Also accepts the bare HSL triplet shadcn/ui v3 themes use ("222.2 47.4% 11.2%").
 */
export function parseColor(input) {
  const s = String(input).trim().toLowerCase()
  if (!s) return null
  if (s === "transparent") return TRANSPARENT
  if (NAMED[s]) return rgba(...NAMED[s])
  if (s.startsWith("#")) return hexToRgb(s)

  const fn = s.match(/^([a-z]+)\((.*)\)$/s)
  if (fn) {
    const [, name, inner] = fn
    if (inner.includes("var(") || inner.includes("(")) return null
    const { parts, alpha } = args(inner)
    if (parts.length < 3) return null
    switch (name) {
      case "rgb":
      case "rgba":
        return rgba(unit(parts[0], 255), unit(parts[1], 255), unit(parts[2], 255), alpha)
      case "hsl":
      case "hsla":
        return hslToRgb(hue(parts[0]), unit(parts[1].endsWith("%") ? parts[1] : `${parts[1]}%`), unit(parts[2].endsWith("%") ? parts[2] : `${parts[2]}%`), alpha)
      case "oklch": {
        const L = unit(parts[0])
        const C = unit(parts[1], 0.4)
        const H = (hue(parts[2]) * Math.PI) / 180
        return oklabToRgb(L, C * Math.cos(H), C * Math.sin(H), alpha)
      }
      case "oklab":
        return oklabToRgb(unit(parts[0]), unit(parts[1], 0.4), unit(parts[2], 0.4), alpha)
      default:
        return null
    }
  }

  // shadcn/ui v3: --primary: 222.2 47.4% 11.2%; (optionally "/ 0.5")
  const bare = s.match(/^(-?[\d.]+)(deg)?\s+([\d.]+)%\s+([\d.]+)%(?:\s*\/\s*([\d.]+%?))?$/)
  if (bare) return hslToRgb(num(bare[1]), num(bare[3]) / 100, num(bare[4]) / 100, bare[5] ? clamp(unit(bare[5]), 0, 1) : 1)

  return null
}

/* -------------------------------------------------------------------- mixing */

/**
 * color-mix(): premultiplied interpolation, as the CSS spec defines it.
 * `t` is the share of `a`. Supports srgb and oklab; oklch and other polar or
 * lab spaces are approximated in oklab.
 */
export function mix(a, b, t, space = "srgb") {
  const alpha = a.a * t + b.a * (1 - t)
  if (alpha === 0) return TRANSPARENT
  if (space === "srgb" || space === "srgb-linear") {
    const ch = (k) => (a[k] * a.a * t + b[k] * b.a * (1 - t)) / alpha
    return rgba(ch("r"), ch("g"), ch("b"), alpha)
  }
  const la = rgbToOklab(a)
  const lb = rgbToOklab(b)
  const ch = (i) => (la[i] * a.a * t + lb[i] * b.a * (1 - t)) / alpha
  return oklabToRgb(ch(0), ch(1), ch(2), alpha)
}

/** Paint `fg` over an opaque `bg` (source-over, in sRGB, like the browser). */
export function composite(fg, bg) {
  if (fg.a >= 1) return fg
  const t = fg.a
  return rgba(fg.r * t + bg.r * (1 - t), fg.g * t + bg.g * (1 - t), fg.b * t + bg.b * (1 - t), 1)
}

/** filter: brightness(k) multiplies the encoded channels. */
export const brightness = (c, k) => rgba(Math.min(255, c.r * k), Math.min(255, c.g * k), Math.min(255, c.b * k), c.a)

/* ----------------------------------------------------------------- WCAG 2.x */

export const luminance = ({ r, g, b }) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)

export function contrast(fg, bg) {
  const l1 = luminance(fg)
  const l2 = luminance(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

export const toHex = ({ r, g, b }) => "#" + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("")
