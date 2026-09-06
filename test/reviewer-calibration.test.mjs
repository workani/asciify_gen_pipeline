import test from "node:test";
import assert from "node:assert/strict";
import { CALIBRATION_CASES, calibrationCaseId, prepareCalibration, scoreCalibration } from "../src/reviewer-calibration.mjs";
import { reviewPaths } from "../src/records.mjs";
import { relevanceTask, parseRelevanceReview } from "../src/record-relevance.mjs";

test("prepared tasks do not leak labels and calibration/holdout cases are separate", () => {
  const first = prepareCalibration(), heldout = prepareCalibration("holdout");
  assert.ok(first.length && heldout.length);
  assert.ok(first.every((row) => !heldout.some((other) => other.case_id === row.case_id)));
  for (const row of [...first, ...heldout]) assert.doesNotMatch(row.user, /"expected"|"label_status"|"split"|"target_id"/);
});

test("an all-supported reviewer cannot pass factual corruption controls", () => {
  const responses = CALIBRATION_CASES.filter((row) => row.split === "calibration" && row.kind === "facts").map((row) => ({ case_id: calibrationCaseId(row),
    response: { entity_id: row.record.entity_id, checks: reviewPaths(row.record).map((path) => ({ path, verdict: "supported", basis: ["description.meaning", "names"].includes(path) || path.startsWith("names.") ? "convention" : "identity", attachments: [], evidence: "Rubber stamp fixture." })) } }));
  const report = scoreCalibration(responses);
  assert.equal(report.passed, false);
  assert.equal(report.complete, false);
  assert.ok(report.false_accepts.count > 0);
  assert.equal(report.production_approval, false);
});

test("missing or duplicate calibration responses cannot look like success", () => {
  assert.equal(scoreCalibration([]).passed, false);
  const row = { case_id: calibrationCaseId(CALIBRATION_CASES.find((c) => c.id === "right-correct")), response: {} };
  assert.throws(() => scoreCalibration([row, row]), /Duplicate/);
});

test("relevance annotation has no designated winner and permits multiple direct matches", () => {
  const fixture = CALIBRATION_CASES.find((row) => row.kind === "relevance");
  const task = relevanceTask({ ...fixture.task, target_id: "a", expected: fixture.expected });
  assert.equal(task.target_id, undefined);
  assert.equal(task.expected, undefined);
  const result = parseRelevanceReview({ query_id: task.query_id, judgments: task.candidates.map((c) => ({ candidate_id: c.id,
    relevance: fixture.expected[c.id], reason: "Direction matches or contradicts the query." })) }, task);
  assert.equal(result.judgments.filter((row) => row.relevance === "direct").length, 2);
  assert.throws(() => parseRelevanceReview({ ...result, judgments: result.judgments.slice(1) }, task), /every candidate/);
});
