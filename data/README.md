# CampusMY reviewed data

These files preserve the existing public UTAR-source collection. They are dated
observations, not a live or complete university registration database.

## Files

- `source-snapshots/campusmy-2026-11-14.json`: all original dataset fields, including
  uncoded curriculum rows, programme records, room evidence and raw lecturer names.
- `source-snapshots/campusmy-2026-11-14.origin.json`: original JavaScript filename,
  byte count and SHA-256, plus the canonical JSON payload digest.
- `seed.json`: normalized, deterministic records for the FastAPI database importer.
- `manifests/seed-manifest.json`: counts, unresolved identity conflicts and warnings.

## Regenerate

From the repository root:

```bash
python3 scripts/import_seed.py --source data/source-snapshots/campusmy-2026-11-14.json
python3 -m unittest discover -s tests/data -v
```

If the original root `data.js` still exists, the script also accepts its strict
`window.CAMPUS_DATA=<JSON>;` format. It never evaluates JavaScript. The script
falls back to the preserved JSON snapshot after the original file is removed.
`--output`, `--snapshot`, and `--manifest` can point to staging paths for review.

The manifest `input_sha256` hashes the compact, UTF-8 canonical JSON payload.
Whitespace changes or conversion from the original assignment to the JSON
snapshot do not produce a new semantic import version. UUIDv5 IDs are stable:
course identity uses institution/campus/code, while original entity IDs key term
offerings, sections and meetings. Raw observations retain their original IDs.

The importer validates all references/times/weeks before replacing output files.
Each file is replaced atomically. Publishing several artifact files is not a
single filesystem transaction; database publication must remain transactional.

## Identity and completeness

There are 689 campus-scoped course identities, 182 published term offerings,
832 sections and 1,087 meetings in the initial seed. All 7,748 curriculum rows
are retained as observations; 7,039 have no course code and remain unmapped.

UJMZ32110 has conflicting PROJECT I / PROJECT II evidence. Its course carries
`raw.identity_status = "needs_review"`. It must not accept permanent course
reviews until an operator resolves the conflict. Explicit known audience
qualifiers are retained as aliases rather than treated as different subjects.
Other names are never guessed or automatically merged by similarity.

Some catalogue records provide a course code without a name. Keep that name
empty and display the known code in the interface; do not invent a title.
Unknown historical/current credits remain unknown. Historical curriculum credits
are not assigned to a current timed offering.

The registry expands 13 original registered sources to 234 URLs, including
programme/structure references found throughout the dataset. An unregistered
source has unknown content hash and modification date. No remote URL was fetched
or independently verified by this conversion. Raw URLs must be reviewed before
any future network refresh; the local converter only accepts HTTPS UTAR hosts.

The root README originally referred to generation and validation scripts absent
from the provided folder. `scripts/import_seed.py` and `tests/data/` supply a new
repeatable conversion and validation workflow for this preserved snapshot.
