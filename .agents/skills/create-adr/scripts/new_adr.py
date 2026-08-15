#!/usr/bin/env python3
"""Preview or create the next numbered ADR without overwriting files."""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from pathlib import Path


ADR_FILE = re.compile(r"^(?P<number>\d{4,})-(?P<slug>[a-z0-9]+(?:-[a-z0-9]+)*)\.md$")
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Preview or create the next NNNN-slug.md ADR."
    )
    parser.add_argument("--adr-dir", type=Path, default=Path("docs/adr"))
    parser.add_argument("--title", required=True)
    parser.add_argument("--slug", required=True)
    parser.add_argument("--status", default="Proposed")
    parser.add_argument("--date", default=dt.date.today().isoformat())
    parser.add_argument("--deciders", default="Repository owner")
    parser.add_argument(
        "--supersedes",
        metavar="ADR_FILE",
        help="Existing ADR filename, for example 0001-old-decision.md",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write the file. Without this flag, print a preview only.",
    )
    return parser.parse_args()


def fail(message: str) -> "NoReturn":
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(2)


def next_number(adr_dir: Path) -> int:
    numbers = []
    if adr_dir.exists():
        for path in adr_dir.iterdir():
            match = ADR_FILE.fullmatch(path.name)
            if match:
                numbers.append(int(match.group("number")))
    return max(numbers, default=0) + 1


def render(template: str, values: dict[str, str]) -> str:
    rendered = template
    for key, value in values.items():
        rendered = rendered.replace("{{" + key + "}}", value)
    unresolved = sorted(set(re.findall(r"{{([a-z_]+)}}", rendered)))
    if unresolved:
        fail(f"unresolved template fields: {', '.join(unresolved)}")
    return rendered.rstrip() + "\n"


def main() -> None:
    args = parse_args()
    if not args.title.strip():
        fail("--title must not be empty")
    if not SLUG.fullmatch(args.slug):
        fail("--slug must be lowercase kebab-case")
    try:
        dt.date.fromisoformat(args.date)
    except ValueError:
        fail("--date must use YYYY-MM-DD")

    script_dir = Path(__file__).resolve().parent
    template_path = script_dir.parent / "assets" / "adr-template.md"
    template = template_path.read_text(encoding="utf-8")

    number = next_number(args.adr_dir)
    number_text = f"{number:04d}"
    destination = args.adr_dir / f"{number_text}-{args.slug}.md"
    if destination.exists():
        fail(f"destination already exists: {destination}")

    supersedes_block = "\n"
    if args.supersedes:
        old_name = Path(args.supersedes).name
        old_match = ADR_FILE.fullmatch(old_name)
        if not old_match:
            fail("--supersedes must be an NNNN-slug.md filename")
        if not (args.adr_dir / old_name).is_file():
            fail(f"superseded ADR does not exist: {args.adr_dir / old_name}")
        supersedes_block = (
            f"- Supersedes: [ADR {old_match.group('number')}]({old_name})\n\n"
        )

    content = render(
        template,
        {
            "number": number_text,
            "title": args.title.strip(),
            "status": args.status.strip(),
            "date": args.date,
            "deciders": args.deciders.strip(),
            "supersedes_block": supersedes_block,
        },
    )

    if not args.write:
        print(f"Preview: {destination}\n")
        print(content, end="")
        return

    args.adr_dir.mkdir(parents=True, exist_ok=True)
    try:
        with destination.open("x", encoding="utf-8") as output:
            output.write(content)
    except FileExistsError:
        fail(f"destination already exists: {destination}")
    print(f"Created {destination}")


if __name__ == "__main__":
    main()
