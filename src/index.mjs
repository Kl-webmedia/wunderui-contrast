/** Programmatic API: run the audit from your own scripts or tests. */
export { runAudit, AA_TEXT, AA_UI } from "./audit.mjs"
export { loadConfig, DEFAULTS } from "./config.mjs"
export { toText, toJson, toMarkdown, summarize } from "./report.mjs"
export { parseColor, contrast, composite, mix, luminance, toHex } from "./color.mjs"
