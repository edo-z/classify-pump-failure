from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Sequence

from app.classification.service import (
    classify_document,
)
from app.data_pipeline.service import (
    ingest_document,
    normalize_document,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.cli",
        description=(
            "Pump Trouble Classification CLI"
        ),
    )

    commands = parser.add_subparsers(
        dest="command",
        required=True,
    )

    ingest = commands.add_parser(
        "ingest",
        help="Ingest a raw CSV document.",
    )

    ingest.add_argument(
        "path",
        type=Path,
        help="Path to the source CSV file.",
    )

    ingest.add_argument(
        "--preview-limit",
        type=int,
        default=20,
        help="Number of preview rows to store.",
    )

    normalize = commands.add_parser(
        "normalize",
        help="Normalize an ingested document.",
    )

    normalize.add_argument(
        "document_id",
        help="Document ID returned by ingest.",
    )

    classify = commands.add_parser(
        "classify",
        help="Classify a normalized document.",
    )

    classify.add_argument(
        "document_id",
        help="Normalized document ID.",
    )

    classify.add_argument(
        "--profile",
        required=True,
        dest="profile_id",
        help="Pump profile ID.",
    )

    return parser


def _print_result(result: object) -> None:
    model_dump_json = getattr(
        result,
        "model_dump_json",
        None,
    )

    if not callable(model_dump_json):
        raise TypeError(
            "CLI result does not support "
            "model_dump_json()"
        )

    print(
        model_dump_json(
            indent=2
        )
    )


def run(
    argv: Sequence[str] | None = None,
) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        if args.command == "ingest":
            path = (
                args.path
                .expanduser()
                .resolve()
            )

            if not path.is_file():
                raise FileNotFoundError(
                    f"Input file not found: {path}"
                )

            if args.preview_limit < 0:
                raise ValueError(
                    "preview-limit must be >= 0"
                )

            result = ingest_document(
                filename=path.name,
                content=path.read_bytes(),
                preview_limit=(
                    args.preview_limit
                ),
            )

        elif args.command == "normalize":
            result = normalize_document(
                args.document_id
            )

        elif args.command == "classify":
            result = classify_document(
                document_id=(
                    args.document_id
                ),
                profile_id=(
                    args.profile_id
                ),
            )

        else:
            parser.error(
                "Unsupported command"
            )
            return 2

        _print_result(
            result
        )

        return 0

    except Exception as exc:
        print(
            (
                f"ERROR[{type(exc).__name__}]: "
                f"{exc}"
            ),
            file=sys.stderr,
        )

        return 1


def main() -> None:
    raise SystemExit(
        run()
    )


if __name__ == "__main__":
    main()
