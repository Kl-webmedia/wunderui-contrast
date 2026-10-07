/**
 * Configuration: contrast.config.{mjs,js,json} in the project root, or flags,
 * or — with neither — the conventions of a shadcn/ui + Tailwind project.
 */

import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const CONFIG_FILES = ["contrast.config.mjs", "contrast.config.js", "contrast.config.json"]

export const CSS_CANDIDATES = [
  "app/globals.css",
  "src/app/globals.css",
  "styles/globals.css",
  "src/styles/globals.css",
  "src/index.css",
  "src/globals.css",
  "src/styles.css",
  "src/app.css",
  "app/app.css",
  "app/tailwind.css",
]

export const COMPONENT_CANDIDATES = [
  ["components/ui/button.tsx", "button"],
  ["src/components/ui/button.tsx", "button"],
  ["components/ui/badge.tsx", "badge"],
  ["src/components/ui/badge.tsx", "badge"],
]

/** shadcn/ui conventions; every token that does not exist is skipped, not failed. */
export const DEFAULTS = {
  canvas: "background",
  defaultText: "foreground",
  autoForeground: true,
  matrix: [
    { inks: ["foreground"], surfaces: ["background", "card", "popover", "muted", "secondary", "accent", "sidebar"] },
    { inks: ["muted-foreground"], surfaces: ["background", "card", "popover", "muted"] },
  ],
  ui: [
    { fg: "input", on: ["background", "card"], label: "input border", level: "warn", note: "the field outline is what identifies an unfilled input (WCAG 1.4.11)" },
    { fg: "ring", on: ["background", "card"], label: "focus ring", level: "warn", note: "focus indicator (WCAG 1.4.11)" },
  ],
}

export async function loadConfig(cwd, flags = {}) {
  let file = flags.config ? resolve(cwd, flags.config) : CONFIG_FILES.map((f) => resolve(cwd, f)).find(existsSync)
  let user = {}
  if (file) {
    if (!existsSync(file)) throw new Error(`config not found: ${file}`)
    user = file.endsWith(".json") ? JSON.parse(readFileSync(file, "utf8")) : (await import(pathToFileURL(file).href)).default
  }

  const config = { ...DEFAULTS, ...user }
  if (flags.css?.length) config.css = flags.css
  if (flags.components?.length) config.components = flags.components.map((f) => ({ file: f }))

  if (!config.css?.length) {
    const found = CSS_CANDIDATES.find((f) => existsSync(resolve(cwd, f)))
    if (!found) throw new Error(`no stylesheet found. Pass --css <file> or add "css" to contrast.config.mjs (looked for ${CSS_CANDIDATES.join(", ")})`)
    config.css = [found]
  }
  if (!config.components) {
    config.components = COMPONENT_CANDIDATES.filter(([f]) => existsSync(resolve(cwd, f))).map(([f, name]) => ({ file: f, name }))
  }
  return { config, file }
}
