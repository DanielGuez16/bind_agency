"""Écrit le contrat d'API que l'app vérifie.

Le fichier produit ne contient que ce qui **fait contrat** : les chemins, leurs
méthodes, l'identifiant d'opération et les codes de réponse. Ni les schémas, ni
les descriptions, ni les paramètres : ils changent à chaque montée de version de
FastAPI et rendraient le fichier illisible en revue, donc invérifiable.

Un test côté app compare chaque route appelée par le client à ce fichier. Sans
lui, une route renommée côté serveur ne se découvre qu'à l'exécution, sur
l'appareil de quelqu'un.

    python scripts/dump_openapi.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import create_app  # noqa: E402

DESTINATION = Path(__file__).resolve().parents[2] / "app" / "src" / "api" / "openapi.json"
METHODES = ("get", "post", "patch", "put", "delete")


def contrat() -> dict:
    spec = create_app().openapi()
    return {
        "paths": {
            chemin: {
                methode: {
                    "operationId": operation.get("operationId"),
                    "responses": sorted(operation.get("responses", {})),
                }
                for methode, operation in operations.items()
                if methode in METHODES
            }
            for chemin, operations in sorted(spec["paths"].items())
        }
    }


if __name__ == "__main__":
    DESTINATION.write_text(json.dumps(contrat(), indent=2, sort_keys=True) + "\n")
    print(f"écrit : {DESTINATION}")
