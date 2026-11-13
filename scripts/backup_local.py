"""Owner-run SQLite online backup/restore to a NEW private file. Not a Supabase backup tool."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import sqlite3


def copy_database(source: Path, output: Path) -> None:
    source, output = source.resolve(), output.resolve()
    if source == output or not source.is_file():
        raise ValueError('Choose an existing source and a different, new output file.')
    # Refuse overwrites and create private permissions before copying any data.
    descriptor = os.open(output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    try:
        with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as origin:
            with sqlite3.connect(output) as destination:
                origin.backup(destination)
                if destination.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise ValueError('The copied database failed integrity verification.')
    except Exception:
        output.unlink(missing_ok=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['backup', 'restore'])
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        copy_database(args.source, args.output)
    except (ValueError, OSError, sqlite3.Error) as error:
        parser.exit(1, f'{error}\n')
    print(f'{args.operation.title()} verified. Output is a new private local file; protect it as account data.')


if __name__ == '__main__':
    main()
