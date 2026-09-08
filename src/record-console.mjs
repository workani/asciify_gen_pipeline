// Shared terminal presentation for live tests and checkpointed cohort runs.
export function createRecordConsole({ total, initialResults = [], stderr = (text) => process.stderr.write(text),
  stdout = (text) => process.stdout.write(text) }) {
  const completed = new Set(initialResults
    .filter((row) => ["passed", "failed", "quarantined"].includes(row.status))
    .map((row) => row.entity_id));
  return {
    start({ directory, reportPath, model, version }) {
      stderr(`Run directory: ${directory}\nReport: ${reportPath}\n`);
      stderr(`Running ${total} characters through ${model} (${version})\n`);
      if (completed.size) stderr(`Resuming with ${completed.size}/${total} saved results\n`);
    },
    result(row) {
      if (["passed", "failed", "quarantined"].includes(row.status)) completed.add(row.entity_id);
      const reason = row.error ? ` — ${String(row.error).replace(/\s+/g, " ")}` : "";
      const glyph = String(row.glyph ?? "").replace(/[\r\n\t\u2028\u2029]/g, " ");
      stderr(`${glyph} U+${row.hex.toUpperCase()} ${row.status} (${row.quality?.model_calls ?? 0} calls)${reason} (${completed.size}/${total})\n`);
    },
    finish(summary, reportPath, printed = summary.results) {
      stdout(JSON.stringify({ report: reportPath, accepted: summary.accepted, total: summary.total, printed }, null, 2) + "\n");
      const count = summary.results.length;
      stderr(`${count === total ? `All ${total}` : `${count}/${total}`} results saved to ${reportPath}\n`);
    },
  };
}
