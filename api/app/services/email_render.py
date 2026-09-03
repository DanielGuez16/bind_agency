"""Rendu HTML des emails transactionnels, un seul gabarit pour seize envois.

**La source de vérité visuelle est la planche Design**, « BIND Emails - Le
gabarit v1 » : cartouche d'encre et logotype, filet de marque, le sujet
répété en titre, le corps du catalogue rendu tel quel, une action, un pied.
Ce module traduit cette planche en Python — les couleurs, les paddings et
l'ordre des blocs sont recopiés d'elle, pas réinventés.

**Le corps du catalogue n'est pas réécrit.** Trois règles, et rien d'autre :
un paragraphe (séparé par une ligne vide) devient un bloc ; `**gras**`
devient une graisse 600 ; un paragraphe ouvert par un tiret cadratin devient
la signature. Un paragraphe qui n'est **que** `{lien}` ou `{url}` devient le
bouton, à la place où le catalogue l'a mis — les deux seuls gabarits
concernés (`account.verification`, `handover.invitation`) le posent en plein
milieu du corps, jamais au bout.

**Le catalogue reste la source unique.** Ce module lit le gabarit brut —
`translate(cle, locale)` sans paramètre rend le texte avec ses `{accolades}`
intactes — pour repérer les paragraphes-bouton avant toute interpolation.
`_emettre` (voir `outbox.py`) interpole déjà le même corps pour le texte
brut envoyé en parallèle ; les deux partagent les mêmes valeurs, jamais deux
calculs qui pourraient diverger.

**Tout est échappé.** `{business}`, `{motif}`, `{reason}` portent du texte
saisi par un commerce ou un administrateur — jamais un script assemblé côté
serveur. Un guillemet ou un chevron qui s'y glisse ne doit ni casser la
mise en page ni s'exécuter dans le client de messagerie.
"""

import html
from dataclasses import dataclass
from typing import Any

from app.core.config import get_settings
from app.core.i18n import available_keys, translate
from app.models.enums import Locale

#: Le seul envoi hors système : avant tout compte, avant tout jeton. Il porte
#: un cartouche plus grand et un pied qui explique que le lien crée le compte
#: au lieu d'en supposer un.
HORS_SYSTEME = frozenset({"handover.invitation"})

#: Les deux seuls gabarits dont le corps pose `{lien}` ou `{url}` en
#: paragraphe séparé — donc le seul cas où le bouton se pose **en ligne**
#: plutôt qu'au bout. La valeur nomme le champ à lire dans `valeurs`.
_CHAMP_DU_LIEN_EN_LIGNE = {
    "account.verification": "lien",
    "handover.invitation": "url",
}

#: Le lien par défaut d'un bouton qui n'ouvre rien de précis — dix des douze
#: gabarits à bouton n'ont rien de plus spécifique que « ouvre l'app ».
#: Choix de la planche, pas de ce module : `renderVals()` le pose en dur, et
#: il ne figure pas dans ses `MANQUES` — Design ne le tient pas pour ouvert.
LIEN_PAR_DEFAUT = "https://bind.app"

#: Nom de l'unique logo servi aux emails. Voir `app/routers/assets.py` : un
#: fichier commis, jamais un dépôt d'objets — la démonstration n'a pas de
#: raison de dépendre d'un compartiment S3 pour afficher sa propre marque.
LOGO_FICHIER = "bind-logo-email.png"

INK = "#17140F"
ORANGE = "#F39120"
PAGE_BG = "#EFEEEB"
TEXTE_CORPS = "#473E31"
TEXTE_DOUX = "#796D5B"
DIVIDER = "#E5E2DE"
POLICE = "'Helvetica Neue',Helvetica,Arial,sans-serif"


@dataclass(frozen=True, slots=True)
class _Bloc:
    # "salutation" | "texte" | "signature" | "bouton" — "bouton" marque la
    # place exacte d'un paragraphe qui n'était que `{lien}`/`{url}`, pour que
    # le bouton s'insère où le catalogue l'a mis et pas systématiquement au
    # bout du corps.
    genre: str
    html: str = ""


def _echapper_gras(ligne: str) -> str:
    """`**gras**` devient une graisse 600, le reste est échappé et rendu tel quel."""
    parts = ligne.split("**")
    if len(parts) == 1:
        return html.escape(ligne)
    morceaux = []
    for i, part in enumerate(parts):
        if not part:
            continue
        texte = html.escape(part)
        morceaux.append(f'<span style="font-weight:600">{texte}</span>' if i % 2 == 1 else texte)
    return "".join(morceaux) if morceaux else html.escape(ligne)


def _decouper(corps_brut: str, valeurs: dict[str, Any]) -> tuple[_Bloc, ...]:
    """Paragraphe par paragraphe, dans l'ordre du catalogue — rien n'est déplacé."""
    paragraphes = corps_brut.rstrip("\n").split("\n\n")
    blocs: list[_Bloc] = []

    for i, brut in enumerate(paragraphes):
        t = brut.strip()
        if not t:
            continue
        if t in ("{lien}", "{url}"):
            blocs.append(_Bloc(genre="bouton"))
            continue

        texte = t.format(**valeurs)
        salutation = i == 0 and texte[-1:] in (",", ":") and len(texte) < 40
        for j, ligne in enumerate(texte.split("\n")):
            if salutation and j == 0:
                genre = "salutation"
            elif ligne.startswith("— "):
                genre = "signature"
            else:
                genre = "texte"
            blocs.append(_Bloc(genre=genre, html=_echapper_gras(ligne)))

    return tuple(blocs)


def _preheader(corps_brut: str, valeurs: dict[str, Any]) -> str:
    """Dérivé du corps, jamais stocké — la planche le documente comme tel dans
    ses manques : la coupe peut tomber au milieu d'une phrase sur un corps
    long, et une clé dédiée coûterait plus qu'elle ne rendrait."""
    paragraphes = [p.strip() for p in corps_brut.rstrip("\n").split("\n\n") if p.strip()]
    if not paragraphes:
        return ""
    i = 1 if (paragraphes[0][-1:] in (",", ":") and len(paragraphes[0]) < 40) else 0
    p = paragraphes[i] if i < len(paragraphes) else paragraphes[0]
    if p in ("{lien}", "{url}") and i + 1 < len(paragraphes):
        p = paragraphes[i + 1]
    texte = p.format(**valeurs).replace("\n", " ")
    return texte[:85].rstrip() + "…" if len(texte) > 85 else texte


def _bouton(cle: str, locale: Locale) -> str | None:
    """Le libellé du bouton, ou `None` sur les quatre gabarits qui n'en ont pas.

    **Absence de clé, et non clé vide.** Un bouton sans libellé serait une
    invention du gabarit ; l'absence dans le catalogue est le signal que rien
    n'est à faire dans cet envoi.
    """
    if f"{cle}.cta" not in available_keys():
        return None
    return translate(f"{cle}.cta", locale=locale)


def _ligne_html(ligne: _Bloc) -> str:
    if ligne.genre == "salutation":
        style = (
            f"padding:18px 32px 0 32px; font-family:{POLICE}; font-size:16px; "
            f"line-height:25px; color:{TEXTE_DOUX};"
        )
    elif ligne.genre == "signature":
        style = (
            f"padding:22px 32px 0 32px; font-family:{POLICE}; font-size:13px; "
            f"line-height:19px; letter-spacing:0.4px; color:{TEXTE_DOUX};"
        )
    else:
        style = (
            f"padding:14px 32px 0 32px; font-family:{POLICE}; font-size:16px; "
            f"line-height:25px; color:{TEXTE_CORPS};"
        )
    return f'<tr><td style="{style}">{ligne.html}</td></tr>'


def _bouton_html(*, lien: str, libelle: str, padding: str) -> str:
    lien_echappe = html.escape(lien, quote=True)
    return (
        f'<tr><td style="{padding}">'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
        f'<td align="center" bgcolor="{ORANGE}" style="border-radius:999px; padding:15px 30px; '
        f'font-family:{POLICE}; font-size:16px; line-height:22px; font-weight:600;">'
        f'<a href="{lien_echappe}" style="color:{INK}; text-decoration:none; display:block;">'
        f"{html.escape(libelle)}</a></td></tr></table></td></tr>"
    )


def rendre_html(cle: str, locale: Locale, *, sujet: str, valeurs: dict[str, Any]) -> str:
    """Le document HTML complet d'un envoi, prêt pour `Message.corps_html`.

    `sujet` arrive déjà rendu par l'appelant (`notifications.rendre`) : un
    second calcul ici en ferait deux, et l'un des deux finirait par diverger
    du sujet réellement porté par l'email.
    """
    settings = get_settings()
    base_api = (settings.api_public_base_url or "").rstrip("/")
    logo_url = f"{base_api}{settings.api_v1_prefix}/assets/{LOGO_FICHIER}"

    corps_brut = translate(f"{cle}.body", locale=locale)
    blocs = _decouper(corps_brut, valeurs)
    preheader = _preheader(corps_brut, valeurs)
    libelle_bouton = _bouton(cle, locale)

    hors_systeme = cle in HORS_SYSTEME
    champ_lien = _CHAMP_DU_LIEN_EN_LIGNE.get(cle)
    lien = str(valeurs[champ_lien]) if champ_lien else LIEN_PAR_DEFAUT

    if hors_systeme:
        entete = (
            f'<tr><td style="background:{INK}; padding:34px 32px 30px 32px;">'
            f'<img src="{html.escape(logo_url, quote=True)}" width="104" height="36" alt="BIND" '
            'style="display:block; width:104px; height:36px; border:0;"></td></tr>'
        )
        pied_raison = translate("email.footer.noAccount", locale=locale)
        pied_liens = translate("email.footer.noAccountLinks", locale=locale)
    else:
        entete = (
            f'<tr><td style="background:{INK}; padding:22px 32px;">'
            f'<img src="{html.escape(logo_url, quote=True)}" width="88" height="30" alt="BIND" '
            'style="display:block; width:88px; height:30px; border:0;"></td></tr>'
        )
        pied_raison = translate("email.footer.account", locale=locale)
        pied_liens = translate("email.footer.accountLinks", locale=locale)

    # Le bouton en ligne se pose exactement où le catalogue a mis
    # `{lien}`/`{url}` — le marqueur porte sa position, jamais recalculée.
    bouton_en_ligne = any(bloc.genre == "bouton" for bloc in blocs)
    morceaux = []
    for bloc in blocs:
        if bloc.genre == "bouton":
            if libelle_bouton:
                morceaux.append(
                    _bouton_html(
                        lien=lien, libelle=libelle_bouton, padding="padding:26px 32px 4px 32px;"
                    )
                )
            continue
        morceaux.append(_ligne_html(bloc))
    lignes_html = "".join(morceaux)

    # Quand le corps ne pose nulle part de paragraphe-lien, un bouton qui
    # existe se rejette au bout — c'est le seul cas où « ouvrir l'app » n'a
    # pas de place plus précise dans le texte.
    bouton_html = ""
    if libelle_bouton and not bouton_en_ligne:
        bouton_html = _bouton_html(
            lien=lien, libelle=libelle_bouton, padding="padding:28px 32px 0 32px;"
        )

    # **Deux lignes, et pas trois.** Design portait une troisième — l'adresse
    # postale — comme un repère à remplir avant l'envoi, pas comme une
    # exigence : c'était son repli faute de vérification juridique, pas la
    # planche. La vérification faite (CAN-SPAM exempte les messages
    # transactionnels/relationnels, GDPR n'exige aucune adresse en pied
    # d'email), Design l'a retirée. Le pied ne porte donc que pourquoi on
    # reçoit ceci, puis les liens.
    pied_html = (
        f'<div style="margin:0 0 8px 0;">{html.escape(pied_raison)}</div>'
        f"<div>{html.escape(pied_liens)}</div>"
    )

    rule = (
        f'<tr><td style="background:{ORANGE}; height:3px; line-height:3px; '
        'font-size:0;">&nbsp;</td></tr>'
    )
    preheader_html = (
        f'<tr><td style="padding:0; height:0; line-height:0; font-size:0;">'
        '<span style="display:none; max-height:0; overflow:hidden; visibility:hidden; '
        f'color:transparent; mso-hide:all;">{html.escape(preheader)}</span></td></tr>'
    )
    titre_html = (
        f'<tr><td style="padding:36px 32px 0 32px; font-family:{POLICE}; font-size:28px; '
        f'line-height:34px; font-weight:700; letter-spacing:-0.02em; color:{INK};">'
        f"{html.escape(sujet)}</td></tr>"
    )
    diviseur = (
        '<tr><td style="padding:36px 32px 0 32px;">'
        f'<div style="height:1px; background:{DIVIDER}; line-height:1px; font-size:0;">'
        "&nbsp;</div></td></tr>"
    )
    pied_tr = (
        f'<tr><td style="padding:20px 32px 30px 32px; font-family:{POLICE}; font-size:13px; '
        f'line-height:19px; color:{TEXTE_DOUX};">{pied_html}</td></tr>'
    )

    carte = (
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" '
        'style="width:600px; background:#FFFFFF; border-collapse:collapse;">'
        f"{entete}{rule}{preheader_html}{titre_html}{lignes_html}{bouton_html}{diviseur}{pied_tr}"
        "</table>"
    )

    return (
        '<!doctype html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>{html.escape(sujet)}</title></head>"
        f'<body style="margin:0; padding:0; background:{PAGE_BG};">'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="background:{PAGE_BG};"><tr><td align="center" style="padding:32px 16px;">'
        f"{carte}</td></tr></table></body></html>"
    )
