#!/usr/bin/env python3
"""Re-score saved discovery samples or prepare full-thread review packets offline."""
import argparse
from collections import Counter
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from se_miner.common import MinerError
from se_miner.extraction import packet
from se_miner.filtering import RULE_HASH, fields_for
from se_miner.inspection import export_rows, report
from se_miner.selection import assess_source, VERSION, HASH
from se_miner.storage import read_db


def export(root, output, mode="audit", allow_partial=False):
    root, output = Path(root).resolve(), Path(output).resolve()
    if output == root or root in output.parents: raise MinerError("Output must be outside the mining work directory")
    db = read_db(root)
    try:
        db.execute("BEGIN")  # one consistent source snapshot throughout export
        coverage = report(db)
        if mode == "threads" and coverage["status"] == "incomplete" and not allow_partial:
            raise MinerError("Thread collection is incomplete; finish/resume ingestion or explicitly use --allow-partial for diagnosis")
        if mode == "threads" and coverage["documents"] == 0:
            raise MinerError("No collected thread context yet; source-hit samples are not extraction packets")
        counts, total = Counter(), 0
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("x") as out:
            header = {"type": "manifest", "selection_version": VERSION, "selection_hash": HASH,
                      "assessment_filter_hash": RULE_HASH, "mode": mode, "coverage": coverage,
                      "source_contract": json.loads(db.execute("SELECT value FROM meta WHERE key='contract'").fetchone()[0]),
                      "export_complete": False,
                      "quality": "provisional_routing_not_verified_dataset",
                      "all_thread_admission_percentage": None}
            out.write(json.dumps(header, ensure_ascii=False) + "\n")
            if mode == "audit":
                for source in db.execute("SELECT * FROM accepted ORDER BY site,kind,rank"):
                    raw = json.loads(source["raw"])
                    role = ("question" if raw.get("PostTypeId") == "1" else "answer") if source["kind"] == "post" else source["kind"]
                    assessment = assess_source(fields_for(source["kind"], raw), role)
                    counts[assessment["lane"]] += 1
                    row = {"type": "source_audit", "site": source["site"], "kind": source["kind"],
                           "id": source["id"], "raw": raw, "selection": assessment,
                           "original_discovery": json.loads(source["assessment"])}
                    out.write(json.dumps(row, ensure_ascii=False) + "\n")
                    total += 1
            else:
                for thread in export_rows(db):
                    value = packet(thread, {"status": coverage["status"], "warnings": coverage["warnings"]})
                    counts[value["selection"]["lane"]] += 1
                    out.write(json.dumps({"type": "review_packet", **value}, ensure_ascii=False) + "\n")
                    total += 1
            result = {"type": "summary", "items": total, "lanes": dict(counts),
                      "export_complete": True,
                      "denominator": "saved accepted source sample" if mode == "audit" else "retained collected threads",
                      "selection_hash": HASH, "all_thread_admission_percentage": None}
            out.write(json.dumps(result) + "\n")
        return result
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("audit", "threads"))
    parser.add_argument("--work-dir", type=Path, default=ROOT / ".miner-work")
    parser.add_argument("--output", type=Path, required=True, help="New JSONL file outside the work directory")
    parser.add_argument("--allow-partial", action="store_true", help="Diagnostic thread export; never claim complete context")
    args = parser.parse_args()
    try:
        print(json.dumps(export(args.work_dir, args.output, args.mode, args.allow_partial), indent=2))
        return 0
    except (MinerError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 2


if __name__ == "__main__": sys.exit(main())
