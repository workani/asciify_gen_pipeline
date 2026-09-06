import { resolveTaxonomy } from './taxonomy.mjs';
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "./config.mjs";
import { contentHash } from "./normalize.mjs";

const modules = new Map();
async function optionalModule(path) {
  if (!existsSync(path)) return null;
  if (!modules.has(path)) modules.set(path, import(pathToFileURL(path).href));
  return modules.get(path);
}

export async function existingVocabulary(entity) {
  const sources = [{ source: "selected-corpus", text: String(entity.existing_synonyms ?? "") }];
  const character = entity.target_kind === "character";
  const file = character ? "_synonyms.mjs" : "_sequence_synonyms.mjs";
  const module = await optionalModule(join(config.asciifyRoot, "scripts", file));
  if (module) {
    const row = { ...entity, code_point: entity.code_point, hex_code: entity.hex, emoji: entity.character, hex_sequence: entity.hex };
    const value = character ? module.synonymsTextFor(row) : module.sequenceSynonymsFor(row);
    sources.push({ source: `asciify/scripts/${file}`, text: Array.isArray(value) ? value.join("; ") : String(value ?? "") });
  }
  const complete = sources.filter((row) => row.text.trim());
  return { sources: complete, fingerprint: contentHash(complete), terms: complete.map((row) => row.text) };
}

// Deduplicate BEFORE either model call, preserving provenance of identical pixels.
export function uniqueRecordRenders(renders) {
  const unique = [], seen = new Map();
  for (const render of renders) {
    const hash = render.analysis?.ink_hash;
    if (!hash) throw new Error("Record render lacks a validated ink fingerprint");
    if (seen.has(hash)) {
      seen.get(hash).equivalent_sources.push({ vendor: render.vendor, platform: render.platform });
    } else {
      const row = { ...render, equivalent_sources: [{ vendor: render.vendor, platform: render.platform }] };
      seen.set(hash, row); unique.push(row);
    }
  }
  return unique;
}

export async function recordContext(entity, renders) {
  const existing = await existingVocabulary(entity);
  // Do not silently truncate to a few tokens. Refuse oversized source context
  // so an operator can curate it without silently disabling duplicate checks.
  if (JSON.stringify(existing.sources).length > 40_000) throw new Error("Existing vocabulary exceeds the 40k character context budget; curate source vocabulary before generating");
  return {
    existing,
    context: {
      taxonomy: resolveTaxonomy(entity),
      identity: { entity_id: entity.entity_id, target_kind: entity.target_kind, target_key: entity.target_key,
        glyph: entity.character, name: entity.name, hex: entity.hex, category: entity.category_key, render_mode: entity.render_mode },
      // Baseline stays outside the writer context and is supplied only to assessment.
      render_mapping: renders.map((render, i) => ({ attachment: i + 1, vendor: render.vendor,
        platform: render.platform, ink_hash: render.analysis.ink_hash, equivalent_sources: render.equivalent_sources ?? [] })),
      render_note: renders.length ? "Attachments contain unique pixel fingerprints only. Equivalent sources are provenance, not additional observations. Scope is computed by code." : "No visible glyph evidence: identity-only record; no appearance or visual properties.",
    },
  };
}
