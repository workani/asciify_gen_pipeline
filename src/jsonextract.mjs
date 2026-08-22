function candidatesFrom(text) {
  const candidates = [];
  for (const fenced of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    try {
      candidates.push({
        start: fenced.index ?? 0,
        end: (fenced.index ?? 0) + fenced[0].length - 1,
        len: fenced[1].length,
        parsed: JSON.parse(fenced[1].trim()),
        fenced: true,
      });
    } catch {}
  }
  for (let i = 0; i < text.length; i++) {
    const opener = text[i];
    if (opener !== "{" && opener !== "[") continue;
    const closer = opener === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === opener) depth++;
      else if (c === closer) {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) continue;
    const slice = text.slice(i, end + 1);
    try {
      const parsed = JSON.parse(slice);
      candidates.push({ start: i, end, len: end - i + 1, parsed, fenced: false });
    } catch {}
  }
  return candidates;
}

function preferredCandidates(text) {
  const candidates = candidatesFrom(text);
  const fenced = candidates.filter((candidate) => candidate.fenced);
  if (fenced.length > 0) return fenced.sort((a, b) => b.len - a.len || b.start - a.start);

  const byEnd = new Map();
  for (const c of candidates) {
    const g = byEnd.get(c.end);
    if (!g || c.start > g.start) byEnd.set(c.end, c);
  }
  const survivors = [...byEnd.values()];
  survivors.sort((a, b) => b.len - a.len || b.start - a.start);
  return survivors;
}

export function extractJsonCandidates(text) {
  return preferredCandidates(String(text ?? "")).map((candidate) => candidate.parsed);
}

export function extractJsonMatching(text, predicate) {
  for (const candidate of preferredCandidates(String(text ?? ""))) {
    try {
      if (predicate(candidate.parsed)) return candidate.parsed;
    } catch {}
  }
  return null;
}

export function extractJson(text) {
  return preferredCandidates(String(text ?? ""))[0]?.parsed ?? null;
}
