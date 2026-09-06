import { resolveTaxonomy } from './taxonomy.mjs';
import { createHash } from "node:crypto";
import { RELEVANCE_REVIEW_SYSTEM, relevanceTask, parseRelevanceReview } from "./record-relevance.mjs";
import { RECORD_REVIEW_SYSTEM, RECORD_VOCABULARY_SYSTEM, recordReviewUser, recordVocabularyUser } from "./prompts-records.mjs";
import { reviewPaths, parseRecordReview } from "./records.mjs";
import { parseVocabularyReview, lexicalMatches } from "./record-vocabulary.mjs";

export const CALIBRATION_VERSION = 4;
// Provisional, auditable fixtures. These are authored controls, NOT a claimed
// human-labeled benchmark. Human review status is deliberately explicit.
const status = "provisional_requires_human_review";
const context = (id, name, glyph) => ({ taxonomy: resolveTaxonomy(glyph), identity: { entity_id: id, name, glyph }, render_mapping: [], render_note: "No rendered image supplied." });
const fact = (ctx, identity, properties = []) => ({ entity_id: ctx.identity.entity_id, status: "ready", family: ctx.taxonomy.family,
  subfamily: ctx.taxonomy.subfamily, subfamily_basis: ctx.taxonomy.subfamily_basis,
  description: { identity, appearance: null, meaning: null }, meaning_evidence: null, names: [], collections: [], properties, uncertainties: [] });
const direction = (value) => ({ key: "direction", values: [value], basis: "identity", attachments: [], evidence: "Proposed reading of the official name." });
function factCase(id, split, ctx, record, expected) {
  return { id, split, kind: "facts", label_status: status, context: ctx, record, expected };
}
const right = context("calibration:right", "BLACK RIGHTWARDS ARROW", "➡");
const down = context("holdout:down", "DOWNWARDS BLACK ARROW", "⬇");
const harpoon = context("calibration:harpoon", "DOWNWARDS HARPOON WITH BARB RIGHTWARDS", "⇂");
const equal = context("holdout:relation", "NOT EQUAL TO", "≠");
const fixtures = [
  factCase("right-correct", "calibration", right, fact(right, "An arrow pointing right.", [direction("right")]), { "description.identity": "supported", "properties.0": "supported" }),
  factCase("right-reversed", "calibration", right, fact(right, "An arrow pointing right.", [direction("left")]), { "properties.0": "reject" }),
  factCase("harpoon-barb-role", "calibration", harpoon, { ...fact(harpoon, "A downward harpoon with its barb on the right.", [direction("down")]) }, { "properties.0": "supported" }),
  factCase("harpoon-travel-confused", "calibration", harpoon, { ...fact(harpoon, "A downward harpoon with its barb on the right.", [direction("right")]) }, { "properties.0": "reject" }),
  factCase("invented-visual-components", "calibration", right, fact(right, "An arrow pointing right.", [{ key: "components", values: ["feathered tail"], basis: "convention", attachments: [], evidence: "The writer calls the tail feathered." }]), { "properties.0": "reject" }),
  factCase("down-correct", "holdout", down, fact(down, "An arrow pointing down.", [direction("down")]), { "description.identity": "supported", "properties.0": "supported" }),
  factCase("down-reversed", "holdout", down, fact(down, "An arrow pointing down.", [direction("up")]), { "properties.0": "reject" }),
  factCase("relation-negation-correct", "holdout", equal, { ...fact(equal, "A not-equal relation sign.") }, { "description.identity": "supported" }),
  factCase("relation-negation-lost", "holdout", equal, { ...fact(equal, "An equality relation sign.") }, { "description.identity": "reject" }),
];
function vocabularyCase(id, split, words, baselinePhrase, expected) {
  const ctx = context(`fixture:${id}`, "SMILING FACE WITH TEAR", "🥲");
  const record = { ...fact(ctx, "A smiling face with a tear."),
    description: { identity: "A smiling face with a tear.", appearance: null, meaning: "Can express gratitude or bittersweet happiness." }, meaning_evidence: { basis: "convention", source: "Informal emoji messaging", evidence: "Used to convey gratitude or mixed happy/sad feelings." } };
  const discovery = { entity_id: record.entity_id, candidates: words.map((phrase, i) => ({ id: `p${i}`, phrase, intent: "use", register: "casual", supports: ["description.meaning"] })) };
  const baseline = [{ id: "baseline:known", phrase: baselinePhrase, sources: ["fixture"], verification: "source-unverified" }];
  return { id, split, kind: "vocabulary", label_status: status, context: ctx, record, discovery, baseline, expected };
}
fixtures.push(
  vocabularyCase("gratitude-echo-bundle", "calibration", ["grateful", "grateful tear", "thankful smile", "feeling grateful"], "grateful", { groups: 1, retained: ["p0", "p1", "p2", "p3"], not_new: ["p0", "p1", "p2", "p3"] }),
  vocabularyCase("gratitude-duplicate-control", "calibration", ["grateful", "GRATEFUL"], "grateful", { groups: 1, retained: ["p0", "p1"], not_new: ["p0", "p1"] }),
  vocabularyCase("mixed-emotion-echo-bundle", "holdout", ["bittersweet happiness", "happy and sad", "sad happy"], "bittersweet happiness", { groups: 1, retained: ["p0", "p1", "p2"], not_new: ["p0", "p1", "p2"] }),
  vocabularyCase("separate-emotion-intents", "holdout", ["grateful", "bittersweet happiness"], "grateful", { groups: 2, retained: ["p0", "p1"], not_new: ["p0"] }),
);
fixtures.push({ id: "multiple-right-arrows", split: "calibration", kind: "relevance", label_status: status,
  task: { query_id: "q:right", query: "right arrow", candidates: [
    { id: "a", glyph: "→", name: "RIGHTWARDS ARROW", facts: "Arrow pointing right." },
    { id: "b", glyph: "←", name: "LEFTWARDS ARROW", facts: "Arrow pointing left." },
    { id: "c", glyph: "⇒", name: "RIGHTWARDS DOUBLE ARROW", facts: "Double arrow pointing right." },
  ] }, expected: { a: "direct", b: "irrelevant", c: "direct" } },
  { id: "multiple-down-arrows", split: "holdout", kind: "relevance", label_status: status,
    task: { query_id: "q:down", query: "down arrow", candidates: [
      { id: "c", glyph: "⇓", name: "DOWNWARDS DOUBLE ARROW", facts: "Double arrow pointing down." },
      { id: "a", glyph: "↓", name: "DOWNWARDS ARROW", facts: "Arrow pointing down." },
      { id: "b", glyph: "↑", name: "UPWARDS ARROW", facts: "Arrow pointing up." },
    ] }, expected: { a: "direct", b: "irrelevant", c: "direct" } });
export const CALIBRATION_CASES = Object.freeze(fixtures);
export const calibrationCaseId = (row) => `case:${createHash("sha256").update(`${CALIBRATION_VERSION}:${row.id}`).digest("hex").slice(0, 16)}`;

export function prepareCalibration(split = "calibration") {
  if (!["calibration", "holdout"].includes(split)) throw new Error("Choose calibration or holdout split");
  return fixtures.filter((row) => row.split === split).map((row) => ({ case_id: calibrationCaseId(row), kind: row.kind,
    system: row.kind === "facts" ? RECORD_REVIEW_SYSTEM : row.kind === "relevance" ? RELEVANCE_REVIEW_SYSTEM : RECORD_VOCABULARY_SYSTEM,
    user: row.kind === "facts" ? recordReviewUser(row.context, row.record, reviewPaths(row.record))
      : row.kind === "relevance" ? JSON.stringify(relevanceTask(row.task)) : recordVocabularyUser(row.context, row.record, row.discovery, row.baseline, lexicalMatches(row.discovery, row.baseline)),
    images: [], label_status: status }));
}

export function scoreCalibration(responses, split = "calibration") {
  const cases = fixtures.filter((row) => row.split === split);
  if (!cases.length) throw new Error("Unknown calibration split");
  const byId = new Map();
  for (const row of responses) {
    if (!cases.some((c) => calibrationCaseId(c) === row.case_id)) throw new Error(`Unexpected case ${row.case_id} for split ${split}`);
    if (byId.has(row.case_id)) throw new Error(`Duplicate calibration response: ${row.case_id}`);
    byId.set(row.case_id, row.response);
  }
  let expectedGood = 0, rejectedGood = 0, expectedBad = 0, acceptedBad = 0;
  const details = [];
  for (const fixture of cases) {
    const raw = byId.get(calibrationCaseId(fixture));
    const failures = [];
    if (!raw) { details.push({ case_id: fixture.id, status: "missing" }); continue; }
    try {
      if (fixture.kind === "facts") {
        const parsed = parseRecordReview(raw, fixture.record);
        for (const [path, expected] of Object.entries(fixture.expected)) {
          const check = parsed.checks.find((row) => row.path === path);
          const accepted = check.verdict === "supported";
          if (expected === "supported") { expectedGood++; if (!accepted) { rejectedGood++; failures.push(`${path}: rejected correct claim`); } }
          else { expectedBad++; if (accepted) { acceptedBad++; failures.push(`${path}: accepted known error`); } }
        }
      } else if (fixture.kind === "relevance") {
        const parsed = parseRelevanceReview(raw, fixture.task);
        for (const [id, expected] of Object.entries(fixture.expected)) {
          const actual = parsed.judgments.find((row) => row.candidate_id === id).relevance;
          if (expected === "direct") { expectedGood++; if (actual !== "direct") { rejectedGood++; failures.push(`${id}: failed to retain another valid match`); } }
          else { expectedBad++; if (["direct", "related"].includes(actual)) { acceptedBad++; failures.push(`${id}: accepted a direction conflict`); } }
        }
      } else {
        // Score raw novelty decisions too: code correction must not hide a bad judge.
        const parsed = parseVocabularyReview(raw, fixture.discovery, fixture.baseline);
        if (parsed.groups.length !== fixture.expected.groups) failures.push(`expected ${fixture.expected.groups} intent groups; got ${parsed.groups.length}`);
        for (const id of fixture.expected.retained) {
          expectedGood++;
          if (!["direct", "related"].includes(parsed.checks.find((row) => row.candidate_id === id).relevance)) {
            rejectedGood++; failures.push(`${id}: discarded a truthful phrase to satisfy diversity`);
          }
        }
        for (const id of fixture.expected.not_new) {
          expectedBad++;
          if (raw.checks.find((row) => row.candidate_id === id).baseline_relation === "proposed-new-intent") {
            acceptedBad++; failures.push(`${id}: credited an echo as a new intent`);
          }
        }
      }
      details.push({ case_id: fixture.id, status: failures.length ? "failed" : "passed", failures });
    } catch (error) { details.push({ case_id: fixture.id, status: "invalid_response", error: error.message }); }
  }
  return { schema_version: CALIBRATION_VERSION, split, label_status: status, cases: details,
    complete: details.every((row) => !["missing", "invalid_response"].includes(row.status)),
    passed: details.every((row) => row.status === "passed"),
    false_accepts: { count: acceptedBad, opportunities: expectedBad, rate: expectedBad ? acceptedBad / expectedBad : null },
    false_rejects: { count: rejectedGood, opportunities: expectedGood, rate: expectedGood ? rejectedGood / expectedGood : null },
    model_calls: 0, production_approval: false };
}
