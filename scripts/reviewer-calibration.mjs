#!/usr/bin/env node
// Offline only: creates blinded reviewer tasks or scores externally supplied
// responses. It never imports the model pool, generates glyphs or calls a service.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { prepareCalibration, scoreCalibration } from "../src/reviewer-calibration.mjs";
const args = process.argv.slice(2);
const option = (name) => args.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const mode = args[0];
if (!["prepare", "score"].includes(mode)) throw new Error("Usage: reviewer-calibration.mjs prepare|score --split=calibration|holdout [--responses=path] [--out=path]");
const split = option("split") ?? "calibration";
let result;
if (mode === "prepare") result = prepareCalibration(split).map((row) => JSON.stringify(row)).join("\n") + "\n";
else {
  const path = option("responses");
  if (!path) throw new Error("score requires --responses=JSONL, rows {case_id,response}");
  const responses = readFileSync(resolve(path), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
  const report = scoreCalibration(responses, split);
  result = JSON.stringify(report, null, 2) + "\n";
  if (!report.passed) process.exitCode = 1;
}
const out = option("out");
if (out) { mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(resolve(out), result); }
else process.stdout.write(result);
