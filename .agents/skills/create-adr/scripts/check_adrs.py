#!/usr/bin/env python3
"""Check basic ADR naming, metadata, structure, numbering, and index coverage."""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from pathlib import Path


ADR_FILE = re.compile(r"^(?P<number>\d{4,})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$")
TITLE = re.compile(r"^# ADR (?P<number>\d{4,}): .+$", re.MULTILINE)
STATUS = re.compile(r"^- Status: (?P<status>.+)$", re.MULTILINE)
DATE = re.compile(r"^- Date: (?P<date>\d{4}-\d{2}-\d{2})$", re.MULTILINE)
REQUIRED_HEADINGS = ("Context", "Decision", "Consequences")
KNOWN_STATUS = re.compile(
    r"^(Proposed|Accepted|Rejected|Deprecated|Superseded by ADR \d{4,})$"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adr-dir", type=Path, default=Path("docs/adr"))
    parser.add_argument(
        "--index",
        type=Path,
        help="ADR index path. Defaults to <adr-dir>/README.md when present.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.adr_dir.is_dir():
        print(f"error: ADR directory not found: {args.adr_dir}", file=sys.stderr)
        raise SystemExit(2)

    errors: list[str] = []
    warnings: list[str] = []
    records: list[tuple[int, Path, str]] = []
    seen_numbers: dict[int, Path] = {}

    for path in sorted(args.adr_dir.glob("*.md")):
        if path.name.lower() == "readme.md":
            continue
        file_match = ADR_FILE.fullmatch(path.name)
        if not file_match:
            warnings.append(f"{path}: filename does not match NNNN-kebab-case.md")
            continue

        number_text = file_match.group("number")
        number = int(number_text)
        previous = seen_numbers.get(number)
        if previous:
            errors.append(f"duplicate ADR {number_text}: {previous} and {path}")
        seen_numbers[number] = path

        text = path.read_text(encoding="utf-8")
        title_match = TITLE.search(text)
        if not title_match:
            errors.append(f"{path}: missing '# ADR {number_text}: <title>'")
        elif title_match.group("number") != number_text:
            errors.append(f"{path}: title number does not match filename")

        status_match = STATUS.search(text)
        status = status_match.group("status").strip() if status_match else ""
        if not status:
            errors.append(f"{path}: missing Status metadata")
        elif not KNOWN_STATUS.fullmatch(status):
            warnings.append(f"{path}: non-standard status '{status}'")

        date_match = DATE.search(text)
        if not date_match:
            errors.append(f"{path}: missing ISO Date metadata")
        else:
            try:
                dt.date.fromisoformat(date_match.group("date"))
            except ValueError:
                errors.append(f"{path}: invalid Date '{date_match.group('date')}'")

        for heading in REQUIRED_HEADINGS:
            if not re.search(rf"^## {re.escape(heading)}$", text, re.MULTILINE):
                errors.append(f"{path}: missing '## {heading}'")

        records.append((number, path, status))

    if not records:
        errors.append(f"no numbered ADR files found in {args.adr_dir}")

    index_path = args.index
    if index_path is None:
        default_index = args.adr_dir / "README.md"
        index_path = default_index if default_index.is_file() else None
    if index_path is not None:
        if not index_path.is_file():
            errors.append(f"ADR index not found: {index_path}")
        else:
            index_text = index_path.read_text(encoding="utf-8")
            for _, path, _ in records:
                if path.name not in index_text:
                    errors.append(f"{index_path}: missing link to {path.name}")

    for message in warnings:
        print(f"warning: {message}", file=sys.stderr)
    for message in errors:
        print(f"error: {message}", file=sys.stderr)
    if errors:
        raise SystemExit(1)

    print(f"OK: validated {len(records)} ADR(s) in {args.adr_dir}")


if __name__ == "__main__":
    main()
