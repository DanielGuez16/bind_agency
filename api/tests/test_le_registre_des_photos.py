"""Le registre des photos réclame ce que le semis ira chercher.

**Le défaut que cette garde ferme a coûté dix-neuf photos.** Le semis dérive le
nom du fichier photo du nom de la prestation ; renommer vingt prestations en
anglais a donc changé dix-neuf chemins, et `A-FOURNIR.md` — qui dit quels
fichiers fournir, avec leur source et leur licence — a continué de réclamer les
anciens. La PR avait 2026 tests verts et quatre jobs verts.

**Rien ne pouvait le voir.** Les photos elles-mêmes sont ignorées par git : les
renommer sur un disque fait disparaître le symptôme sur cette machine et sur
elle seule. Le seul signal était deux lignes de la sortie du semis — « 83
fournies, 19 générées faute de fichier » — c'est-à-dire un endroit que rien
n'oblige à lire.

**Les deux sens comptent, et pour des raisons différentes.** Un chemin réclamé
par le semis et absent du registre est une photo que personne ne saura fournir :
un dégradé silencieux. Un chemin au registre que le semis ne demande plus est
une photo qu'on ira chercher pour rien — et surtout le signe qu'un renommage
n'a été fait qu'à moitié. C'est cette seconde forme qui a manqué ici.

**Les chemins sont dérivés par les fonctions du semis**, jamais recalculés ici.
Une garde qui recopierait la règle de nommage vérifierait sa propre copie : elle
resterait verte le jour où la règle change, ce qui est précisément le jour où
elle doit tomber.

**Bornée aux prestations des salons du marché**, et c'est le périmètre exact de
la dérivation. Les trois salons écrits à la main nomment leurs fichiers dans
`FICHIER_DE_LA_PRESTATION`, donc un renommage de libellé ne les déplace pas. Les
couvertures ne sont pas dans ce registre — elles ont leur repli en portrait — et
les y chercher ferait crier la garde sur seize chemins qui n'y ont jamais figuré.
"""

import re
from pathlib import Path

from app import seed
from app.core.config import API_ROOT
from app.seed_demo import (
    DOSSIER_DU_COMMERCE,
    FICHIER_DE_LA_PRESTATION,
    _dossier_derive,
)

REGISTRE = API_ROOT.parent / "assets" / "photos" / "A-FOURNIR.md"


def _reclames_par_le_semis() -> tuple[set[str], set[str]]:
    """Les chemins que le semis ira chercher, et les dossiers concernés."""
    chemins: set[str] = set()
    dossiers: set[str] = set()
    for salon in seed.MARCHE:
        dossier = DOSSIER_DU_COMMERCE.get(salon.nom) or _dossier_derive(salon.nom)
        dossiers.add(dossier)
        for item in salon.items:
            fichier = FICHIER_DE_LA_PRESTATION.get(item[0]) or _dossier_derive(item[0])
            chemins.add(f"commerces/{dossier}/prestations/{fichier}.jpg")
    return chemins, dossiers


def _listes_au_registre(dossiers: set[str]) -> set[str]:
    """Les prestations que le registre réclame, pour ces salons-là."""
    texte = Path(REGISTRE).read_text(encoding="utf-8")
    tous = set(re.findall(r"`(commerces/[^`]+)`", texte))
    return {
        chemin for chemin in tous if "/prestations/" in chemin and chemin.split("/")[1] in dossiers
    }


def test_le_registre_reclame_exactement_ce_que_le_semis_ira_chercher() -> None:
    reclames, dossiers = _reclames_par_le_semis()
    listes = _listes_au_registre(dossiers)

    # **Le décor n'est pas vide, et c'est ce qui rend le reste probant.** Deux
    # ensembles vides sont égaux : sans cette ligne, une expression de recherche
    # cassée — un accent grave changé, un dossier renommé — rendrait la garde
    # verte en ne comparant plus rien.
    assert len(reclames) >= 40, f"le semis ne réclame que {len(reclames)} prestations"

    assert {
        "manquantes au registre": sorted(reclames - listes),
        "réclamées par personne": sorted(listes - reclames),
    } == {"manquantes au registre": [], "réclamées par personne": []}
