"""Schreibt das OpenAPI-Schema der FastAPI-App nach packages/contracts/openapi.json.

Importiert die App ohne Netzwerkzugriff. Aufruf: pnpm contracts (oder
uv run --project apps/api python scripts/export_openapi.py).
"""

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT = REPO_ROOT / "packages" / "contracts" / "openapi.json"

# src-Layout direkt einbinden: unabhängig von der .pth-Datei im .venv (macOS-Hidden-Flag).
sys.path.insert(0, str(REPO_ROOT / "apps" / "api" / "src"))

from trend_detective.main import create_app  # noqa: E402


def main() -> None:
    schema = create_app().openapi()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"OpenAPI geschrieben: {OUTPUT.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
