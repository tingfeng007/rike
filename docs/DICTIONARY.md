# Built-in English-Chinese dictionary

The dictionary bundles 59,136 common ECDICT entries. It includes entries with an
exam tag, Oxford flag, Collins stars, or a positive BNC/COCA frequency rank up to
50,000. Headwords must begin with an ASCII letter and contain only letters,
spaces, apostrophes, periods or hyphens, up to 64 characters. This is a selected
learning dictionary, not the full 770,611-entry upstream database.

Source: https://github.com/skywind3000/ECDICT

Pinned source commit: `bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b`.
The MIT license is distributed as `public/dictionary/ECDICT-LICENSE.txt`.
The manifest records the source SHA-256, count and byte size of every shard.

To reproduce, download `ecdict.csv` and `LICENSE` from that commit, then run:

```powershell
python scripts/build-dictionary.py <csv-path> <license-path>
```

The 11 MB dictionary is split into 26 immutable JSON files. A lookup fetches one
letter, not the entire dictionary. Cache Storage saves loaded shards. Explicit
offline download stores all 26; cancellation preserves completed shards so a
later download resumes. Successful lookups are additionally saved in a bounded
local cache (40 results, about 300,000 characters), with 12 recent search terms.
Local cache failure does not block lookup, and saving a flashcard still uses the
existing storage service and review scheduling rules.

Pronunciation, bilingual examples and senses for the existing curated decks are
merged into matching entries. Additional bilingual examples and collocations
use the user's configured AI service, only when the user clicks the explicit
AI action. AI examples are labelled. Missing entries offer an explicit online
English lookup using https://dictionaryapi.dev/; it does not provide Chinese
translations, and the UI labels those results as English-only.

Dictionary queries accept English words and phrases. Chinese reverse lookup is
not included. Audio uses the existing non-course speech service. The original
New Concept course recordings are unchanged.
