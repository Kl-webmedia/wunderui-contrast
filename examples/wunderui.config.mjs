/**
 * The WunderUI design system's own audit (https://wunderui.com).
 * Run from the WunderUI repository root:
 *   npx @wunderui/contrast --config contrast.config.mjs
 *
 * Shows what a config can do beyond the defaults: an ink x surface matrix,
 * tint pairs, and a badge matrix built with plain loops — the config is a
 * module, so pairs can be generated from the component's own data.
 */

import { readFileSync } from "node:fs"

const PAGE = ["background", "bg-page", "card", "popover"]
const PANEL = ["muted", "subtle", "accent"]
const INKS = ["foreground", "text-secondary", "text-tertiary", "text-link", "text-success", "text-error", "text-warning"]
const HUES = ["indigo", "blue", "purple", "pink", "red", "orange", "yellow", "green", "alternative"]

/* ---- badges: six styles x twelve colours, mirroring badge.tsx ---- */

const BADGE_COLORS = {
  blue: "#12AFF0",
  green: "#1AD598",
  red: "#F47690",
  yellow: "#FACA4A",
  purple: "#A584F3",
  indigo: "#555CF3",
  pink: "#FE6BBA",
  orange: "#F3654A",
  alternative: "#6E6D86",
  grey: "#A2A3A3",
  black: "#000000",
  white: "#FFFFFF",
}
const WHITE_TEXT_ON = ["indigo", "alternative", "black"]
const SOLID_TEXT = { blue: "#053143", purple: "#2E2544", pink: "#471E34", red: "#442128", orange: "#441C15", yellow: "#463915", green: "#073C2B", grey: "#2D2E2E" }
const ACHROMATIC = {
  black: { bg: "var(--dark-200)", text: "#000000", ink: "var(--foreground)" },
  white: { bg: "var(--muted)", text: "var(--foreground)", ink: "var(--foreground)" },
  grey: { bg: "color-mix(in srgb, #A2A3A3 10%, var(--card))", text: "var(--text-tertiary)", ink: "var(--text-tertiary)" },
}

function badge(color, style) {
  const hex = BADGE_COLORS[color]
  const flat = ACHROMATIC[color]
  const tinted = HUES.includes(color)
  const tintBg = flat ? flat.bg : tinted ? `var(--tint-${color})` : `color-mix(in srgb, ${hex} 12%, var(--card))`
  const tintText = flat ? flat.text : tinted ? `var(--tint-text-${color})` : hex
  const ink = flat ? flat.ink : tintText
  switch (style) {
    case "plain":
      return { bg: hex, fg: WHITE_TEXT_ON.includes(color) ? "#FFFFFF" : (SOLID_TEXT[color] ?? "#000000") }
    case "light":
    case "light_border":
      return { bg: tintBg, fg: tintText }
    default: // border_color, border_grey, ghost sit on the card
      return { bg: "var(--card)", fg: ink }
  }
}

// The hover filter is read from the component, so the audit follows the code.
const badgeSrc = readFileSync(new URL("./packages/react/src/components/ui/badge.tsx", `file:///${process.cwd().replace(/\\/g, "/")}/`), "utf8")
const k = (re) => {
  const m = badgeSrc.match(re)
  return m ? (Number(m[1]) > 3 ? Number(m[1]) / 100 : Number(m[1])) : undefined
}
const lightHover = k(/(?<!dark:)\[&:is\(button,a\)\]:hover:brightness-\[?([\d.]+)\]?/)
const darkHover = k(/dark:\[&:is\(button,a\)\]:hover:brightness-\[?([\d.]+)\]?/) ?? lightHover

const badgePairs = []
for (const color of Object.keys(BADGE_COLORS)) {
  for (const style of ["plain", "light", "light_border", "border_color", "border_grey", "ghost"]) {
    const { fg, bg } = badge(color, style)
    badgePairs.push({ section: "badges", label: `${color} / ${style}`, fg, bg })
    if (lightHover) badgePairs.push({ section: "badges", label: `${color} / ${style} @hover`, fg, bg, brightness: { light: lightHover, dark: darkHover } })
  }
}

export default {
  css: ["packages/react/src/styles.css"],
  matrix: [
    { inks: INKS, surfaces: [...PAGE, ...PANEL] },
    { inks: ["muted-foreground"], surfaces: ["muted", ...PAGE] },
    ...HUES.map((hue) => ({ inks: [`tint-text-${hue}`], surfaces: [`tint-${hue}`, "card", "background"] })),
  ],
  pairs: badgePairs,
  components: [{ file: "packages/react/src/components/ui/button.tsx", name: "button", under: ["background", "card"] }],
  ui: [
    { fg: "input", on: ["background", "card", "bg-page"], label: "input border", level: "error", note: "Input is border-input on a transparent fill in light mode" },
    { fg: "muted-foreground", on: ["background", "card"], label: "checkbox / radio border", level: "error", note: "the box has no fill until it is checked" },
    { fg: "ring", on: ["background", "card", "bg-page", "muted"], label: "focus ring", level: "error" },
  ],
}
