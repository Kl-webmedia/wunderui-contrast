#!/usr/bin/env node
/**
 * wunderui-contrast — WCAG 2.x contrast audit for design tokens and Tailwind
 * component variants. Exit code 1 when a check fails, so it can gate CI.
 */

import { readFileSync } from "node:fs"
import { loadConfig } from "../src/config.mjs"
import { runAudit } from "../src/audit.mjs"
import { summarize, toJson, toMarkdown, toText } from "../src/report.mjs"

const HELP = `wunderui-contrast — WCAG contrast audit for design tokens and component variants

Usage: wunderui-contrast [options]

  --config <file>     contrast.config.mjs|js|json (default: found in the current folder)
  --css <file>        stylesheet with the tokens (repeatable; default: auto-detected)
  --component <file>  file with a cva() variant map (repeatable; default: components/ui/button|badge.tsx)
  --all               list every check, not only the failures
  --json              machine-readable output
  --md                Markdown (for $GITHUB_STEP_SUMMARY or a PR comment)
  --fail-on <level>   error (default) or warn — warnings are UI boundaries below 3:1
  --cwd <dir>         project root (default: current folder)
  -v, --version       print the version
  -h, --help          this help

Zero-config in a shadcn/ui project: checks every *-foreground token on its fill,
text on every surface, each button and badge variant at rest and on hover in
light and dark, and flags input borders and focus rings below 3:1.`

function parseArgs(argv) {
  const flags = { css: [], components: [], failOn: "error" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v == null) throw new Error(`${a} needs a value`)
      return v
    }
    if (a === "--config") flags.config = next()
    else if (a === "--css") flags.css.push(next())
    else if (a === "--component") flags.components.push(next())
    else if (a === "--cwd") flags.cwd = next()
    else if (a === "--fail-on") flags.failOn = next()
    else if (a === "--all") flags.all = true
    else if (a === "--json") flags.format = "json"
    else if (a === "--md" || a === "--markdown") flags.format = "md"
    else if (a === "-h" || a === "--help") flags.help = true
    else if (a === "-v" || a === "--version") flags.version = true
    else throw new Error(`unknown option ${a} (see --help)`)
  }
  if (!["error", "warn"].includes(flags.failOn)) throw new Error("--fail-on takes error or warn")
  return flags
}

try {
  const flags = parseArgs(process.argv.slice(2))
  if (flags.help) {
    console.log(HELP)
    process.exit(0)
  }
  if (flags.version) {
    console.log(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version)
    process.exit(0)
  }
  const cwd = flags.cwd ?? process.cwd()
  const { config } = await loadConfig(cwd, flags)
  const result = runAudit(config, cwd)
  const opts = { all: flags.all, failOn: flags.failOn }
  const out = flags.format === "json" ? toJson(result, opts) : flags.format === "md" ? toMarkdown(result, opts) : toText(result, opts)
  console.log(out)
  process.exit(summarize(result, flags.failOn).ok ? 0 : 1)
} catch (error) {
  console.error(`wunderui-contrast: ${error.message}`)
  process.exit(2)
}
