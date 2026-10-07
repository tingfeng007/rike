"""Build the bundled English-Chinese dictionary from a pinned ECDICT CSV.

Usage: python scripts/build-dictionary.py <path-to-ecdict.csv> <path-to-LICENSE>
The raw source is deliberately kept outside the checkout (63 MB).
"""
import csv
import hashlib
import json
from pathlib import Path
import re
import sys

SOURCE_COMMIT = "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b"
VERSION = "ecdict-bc015ed-v1"
ROOT = Path(__file__).resolve().parents[1]
output = ROOT / "public" / "dictionary" / VERSION
output.mkdir(parents=True, exist_ok=True)
shards = {letter: {} for letter in "abcdefghijklmnopqrstuvwxyz"}


def rank(value):
    return int(value or 0)


with Path(sys.argv[1]).open(encoding="utf-8", newline="") as source:
    for row in csv.DictReader(source):
        word = row["word"].strip()
        if not re.fullmatch(r"[a-zA-Z][a-zA-Z '.-]{0,63}", word) or not row["translation"]:
            continue
        common = (row["tag"] or rank(row["oxford"]) or rank(row["collins"])
                  or 0 < rank(row["bnc"]) <= 50000 or 0 < rank(row["frq"]) <= 50000)
        if not common:
            continue
        key = word.lower()
        if key in shards[key[0]]:
            continue
        # Packed rows keep per-letter downloads small; decoded in services/dictionary.js.
        shards[key[0]][key] = [word, row["phonetic"], row["translation"],
                               row["definition"], row["exchange"], row["tag"]]

manifest = {"version": VERSION, "source": "https://github.com/skywind3000/ECDICT",
            "commit": SOURCE_COMMIT, "license": "MIT", "shards": {}}
for letter, entries in shards.items():
    payload = json.dumps(entries, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    (output / f"{letter}.json").write_bytes(payload)
    manifest["shards"][letter] = {"count": len(entries), "bytes": len(payload)}
manifest["count"] = sum(part["count"] for part in manifest["shards"].values())
manifest["bytes"] = sum(part["bytes"] for part in manifest["shards"].values())
manifest["sourceSha256"] = hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest()
(output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(ROOT / "public" / "dictionary" / "ECDICT-LICENSE.txt").write_bytes(Path(sys.argv[2]).read_bytes())
print(json.dumps({"count": manifest["count"], "bytes": manifest["bytes"], "version": VERSION}))
