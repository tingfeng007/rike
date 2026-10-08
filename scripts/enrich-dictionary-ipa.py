"""Fill missing phonetics from pinned MIT ipa-dict data without generating pronunciations.

Usage: python scripts/enrich-dictionary-ipa.py <en_US.txt> <ipa-dict LICENSE>
Run after build-dictionary.py. Existing ECDICT pronunciations are preserved.
"""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'public' / 'dictionary' / 'ecdict-bc015ed-ipa-v2'
if not OUTPUT.is_dir():
    raise SystemExit('Create ecdict-bc015ed-ipa-v2 with build-dictionary.py first.')
source = Path(sys.argv[1])
pronunciations = {}
for line in source.read_text(encoding='utf-8').splitlines():
    if '\t' not in line:
        continue
    word, ipa = line.split('\t', 1)
    pronunciations[word.lower()] = ipa.split(',')[0].strip().strip('/')
filled = missing = 0
manifest = json.loads((OUTPUT / 'manifest.json').read_text(encoding='utf-8'))
manifest['version'] = OUTPUT.name
for letter in 'abcdefghijklmnopqrstuvwxyz':
    file = OUTPUT / f'{letter}.json'
    rows = json.loads(file.read_text(encoding='utf-8'))
    for word, row in rows.items():
        if not row[1].strip() and pronunciations.get(word):
            row[1] = pronunciations[word]
            row.append('ipa-dict · General American')
            filled += 1
        if not row[1].strip():
            missing += 1
    payload = json.dumps(rows, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode('utf-8')
    file.write_bytes(payload)
    manifest['shards'][letter] = {'count': len(rows), 'bytes': len(payload)}
manifest['bytes'] = sum(part['bytes'] for part in manifest['shards'].values())
manifest['phonetics'] = {'source': 'https://github.com/open-dict-data/ipa-dict', 'commit': '43c3570eb3553bdd19fccd2bd0091534889af023', 'license': 'MIT', 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'filled': filled, 'missing': missing}
(OUTPUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(OUTPUT.parent / 'IPA-DICT-LICENSE.txt').write_bytes(Path(sys.argv[2]).read_bytes())
print(json.dumps({'filled': filled, 'missing': missing, 'version': OUTPUT.name}))
