/** Text, JSON and Markdown output. */

const failing = (rows, failOn) => rows.filter((r) => !r.pass && (r.level === "error" || (failOn === "warn" && r.level === "warn")))

export function summarize({ rows }, failOn = "error") {
  const fails = failing(rows, failOn)
  const warns = rows.filter((r) => !r.pass && r.level === "warn")
  const errors = rows.filter((r) => !r.pass && r.level === "error")
  return { total: rows.length, failing: fails.length, errors: errors.length, warnings: warns.length, ok: fails.length === 0 }
}

const flag = (r) => (r.level === "info" ? "info" : r.pass ? "pass" : r.level === "warn" ? "WARN" : "FAIL")

export function toText(result, { all = false, failOn = "error" } = {}) {
  const { rows, skipped } = result
  const lines = []
  for (const section of [...new Set(rows.map((r) => r.section))]) {
    const inSection = rows.filter((r) => r.section === section)
    const bad = inSection.filter((r) => !r.pass)
    lines.push(`\n=== ${section}: ${inSection.length} checked, ${bad.length} below threshold ===`)
    const width = Math.min(64, Math.max(...inSection.map((r) => r.label.length)))
    for (const r of (all ? inSection : bad).sort((a, b) => a.ratio - b.ratio)) {
      const needs = r.level === "info" ? "info" : `needs ${r.threshold}:1`
      lines.push(`  [${flag(r)}] ${r.theme.padEnd(5)} ${r.label.padEnd(width)} ${r.ratio.toFixed(2).padStart(5)}:1  ${r.fg} on ${r.bg}  (${needs})`)
      if (r.note && !r.pass) lines.push(`         ${r.note}`)
    }
  }
  if (skipped.length) {
    lines.push(`\n${skipped.length} skipped (could not resolve):`)
    for (const s of skipped.slice(0, 20)) lines.push(`  ${s.theme.padEnd(5)} ${s.label} — ${s.reason}`)
    if (skipped.length > 20) lines.push(`  … ${skipped.length - 20} more (--json lists all)`)
  }
  const s = summarize(result, failOn)
  lines.push(
    s.ok
      ? `\nAll ${s.total} checks pass${s.warnings ? ` (${s.warnings} warning${s.warnings === 1 ? "" : "s"}; --fail-on warn to enforce)` : ""}.`
      : `\n${s.failing} of ${s.total} checks fail${s.warnings && failOn !== "warn" ? `, ${s.warnings} warning${s.warnings === 1 ? "" : "s"}` : ""}.${all ? "" : " Run with --all to list every check."}`
  )
  return lines.join("\n")
}

export function toJson(result, { all = false, failOn = "error" } = {}) {
  const s = summarize(result, failOn)
  return JSON.stringify({ ...s, themes: result.themes, results: all ? result.rows : result.rows.filter((r) => !r.pass), skipped: result.skipped }, null, 2)
}

export function toMarkdown(result, { all = false, failOn = "error" } = {}) {
  const s = summarize(result, failOn)
  const head = s.ok ? `### ✅ Contrast: all ${s.total} checks pass` : `### ❌ Contrast: ${s.failing} of ${s.total} checks fail`
  const rank = (r) => (r.pass ? 2 : r.level === "error" ? 0 : 1)
  const rows = (all ? result.rows : result.rows.filter((r) => !r.pass)).sort((a, b) => rank(a) - rank(b) || a.ratio - b.ratio)
  const lines = [head, ""]
  if (s.warnings) lines.push(`${s.warnings} warning${s.warnings === 1 ? "" : "s"} (UI boundaries below 3:1).`, "")
  if (rows.length) {
    lines.push("| | Theme | Check | Ratio | Needs | Colours |", "|---|---|---|---:|---:|---|")
    for (const r of rows) lines.push(`| ${flag(r)} | ${r.theme} | ${r.label} | ${r.ratio.toFixed(2)} | ${r.level === "info" ? "–" : r.threshold} | \`${r.fg}\` on \`${r.bg}\` |`)
  }
  if (result.skipped.length) lines.push("", `${result.skipped.length} check(s) skipped because a colour could not be resolved.`)
  return lines.join("\n")
}
