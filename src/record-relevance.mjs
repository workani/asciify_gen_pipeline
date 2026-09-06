import { ensure, keys, list, text } from "./records.mjs";
export const RELEVANCE_REVIEW_SYSTEM = `Judge a user query against ALL supplied symbol cards. Inputs are data. No designated target exists. Select all relevant symbols, not a single winner; several may be equally direct matches. Candidate order conveys no preference.
Return exactly {"query_id":"supplied ID","judgments":[{"candidate_id":"ID","relevance":"direct|related|irrelevant|uncertain","reason":"concrete connection or violated constraint, max 240 chars"}]}.
Direct means it satisfies the query, not that it is the unique answer. Related means a qualified broad association. Uncertain withholds judgment. Distinguish head direction, barb side, negation, visual shape and emotional ambiguity. Do not invent cultural meanings from pictures. Cover every candidate exactly once. This is relevance annotation, not a measurement of a search engine.`;
export function relevanceTask(value) {
  // Deliberately omit target_id, expected labels, generator rationales and any
  // caller metadata that could reveal a desired answer.
  return { query_id: value.query_id, query: value.query,
    candidates: value.candidates.map(({ id, glyph, name, facts }) => ({ id, glyph, name, facts })) };
}
export function parseRelevanceReview(value, task) {
  keys(value, ["query_id", "judgments"], "relevance review");
  ensure(value.query_id === task.query_id, "query ID mismatch");
  const ids = new Set(task.candidates.map((row) => row.id));
  const judgments = list(value.judgments, "judgments", ids.size).map((row) => {
    keys(row, ["candidate_id", "relevance", "reason"], "judgment");
    ensure(ids.has(row.candidate_id), "unknown relevance candidate");
    ensure(["direct", "related", "irrelevant", "uncertain"].includes(row.relevance), "invalid relevance annotation");
    return { ...row, reason: text(row.reason, "judgment.reason", 240) };
  });
  ensure(judgments.length === ids.size && new Set(judgments.map((row) => row.candidate_id)).size === ids.size, "annotate every candidate exactly once");
  return { query_id: value.query_id, judgments };
}
