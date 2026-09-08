#!/usr/bin/env python3
"""Replay saved source fields offline. Never opens a work DB or calls a model."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from se_miner.filtering import classify, RULE_HASH, VERSION


def evaluate(path):
    raw = path.read_bytes()
    dataset = json.loads(raw)
    matrix, baseline, failures, predictions = Counter(), Counter(), [], []
    seen = set()
    for case in dataset["cases"]:
        key, label = str(case["reference"]), case["label"]
        if key in seen or label not in ("KEEP", "REJECT", "UNCERTAIN"):
            raise ValueError("Invalid or duplicate reference: " + key)
        seen.add(key)
        result = classify(case["fields"], source_role=case["role"])
        matrix[label, result["decision"]] += 1
        old = case.get("baseline", {})
        baseline[label, "retained" if old.get("candidate") else "rejected"] += 1
        if label != "UNCERTAIN" and result["candidate"] != (label == "KEEP"):
            failures.append(key)
        predictions.append({"reference": key, "site": case["site"], "id": case["id"],
            "label": label, "decision": result["decision"], "status": result["status"],
            "score": result["score"], "baseline_score": old.get("score"),
            "resolution": result["resolution"], "bindings": result["bindings"],
            "review_reasons": result["review_reasons"]})
    def table(counter):
        return {label: {decision: n for (item, decision), n in sorted(counter.items()) if item == label}
                for label in ("KEEP", "REJECT", "UNCERTAIN")}
    return {"dataset": str(path), "sha256": hashlib.sha256(raw).hexdigest(),
            "purpose": dataset["purpose"], "cases": len(seen),
            "baseline_version": dataset["baseline_version"], "baseline": table(baseline),
            "current": table(matrix), "failures": failures, "predictions": predictions}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, action="append", help="Repeat to evaluate additional labeled JSON fixtures")
    parser.add_argument("--output", type=Path, help="Write the full JSON report here")
    args = parser.parse_args()
    paths = args.dataset or [ROOT / "test/miner/fixtures" / name for name in
                            ("discovery-reference.json", "discovery-v5-audit.json")]
    report = {"version": VERSION, "rule_hash": RULE_HASH,
              "limitations": ["Calibration replay, not held-out production precision or recall.",
                  "Current web reference snapshots do not establish archive availability.",
                  "Accepted-hit samples cannot estimate whole-corpus or thread admission rates.",
                  "No Unicode resolution correctness or LLM quality is measured."],
              "stage_3_thread_percentage": None,
              "datasets": [evaluate(path.resolve()) for path in paths]}
    report["checks_passed"] = all(not d["failures"] for d in report["datasets"])
    output = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output)
        for d in report["datasets"]:
            print(Path(d["dataset"]).name, json.dumps(d["current"]), "failures:", d["failures"])
        print("Report:", args.output.resolve())
    else:
        print(output, end="")
    return 0 if report["checks_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
