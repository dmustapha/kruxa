#!/usr/bin/env python3
"""Writes every file embedded in ARCHITECTURE.md to disk.

A code block is a file when its first line is `// File: <path>` or `# File: <path>`; that header line is not part of the
file and is stripped. Blocks whose path starts with "(" are diagrams or shell snippets and are skipped.

    python3 scripts/extract_architecture.py ARCHITECTURE.md ./kruxa-repo
"""
import pathlib
import re
import sys

HEADER = re.compile(r"^(?://|#) File: (\S.*?)\s*$")


def blocks(text):
    inside, buf = False, []
    for line in text.splitlines():
        if line.startswith("```"):
            if inside:
                yield buf
                buf = []
            inside = not inside
        elif inside:
            buf.append(line)


def main(doc, out):
    written = 0
    for b in blocks(pathlib.Path(doc).read_text()):
        m = HEADER.match(b[0]) if b else None
        if not m or m.group(1).startswith("("):
            continue
        dest = pathlib.Path(out) / m.group(1)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text("\n".join(b[1:]) + "\n")
        if dest.suffix == ".sh":
            dest.chmod(0o755)
        written += 1
    print(f"wrote {written} files under {out}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
