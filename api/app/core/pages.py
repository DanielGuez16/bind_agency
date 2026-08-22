"""Les rares pages que le serveur rend lui-même, en HTML.

**Une seule aujourd'hui, et elle existe pour une raison précise.** Un lien de
confirmation d'adresse s'ouvre dans un navigateur : il ne peut pas viser
l'application — elle n'est pas forcément installée, et aucun navigateur ne sait
ouvrir un schéma privé à coup sûr. Il vise donc l'API, et l'API doit répondre
quelque chose qu'un être humain puisse lire.

Elle rendait `UserRead`. Quelqu'un qui cliquait dans son courriel voyait
`{"id":"…","email":"…","role":"creator"}` — sur le **tout premier geste** qu'il
fait avec le produit, et sur le seul écran qui décide s'il continue. La
mécanique était juste, ce qu'il voyait ne l'était pas.

**Rien d'extérieur.** Pas de feuille de style distante, pas de police
téléchargée, pas d'image : cette page s'ouvre parfois dans le navigateur intégré
d'un client de messagerie, sur le réseau d'un salon, et une page qui dépend d'un
second aller-retour est une page qui reste blanche.

**Les textes viennent du catalogue serveur**, comme les courriels. Une chaîne
écrite ici serait la seule de tout le produit à n'exister qu'en anglais.
"""

from html import escape

from app.core.i18n import translate
from app.models.enums import Locale

#: Les couleurs sont recopiées de `design_handoff_bind/tokens.json`, et c'est
#: assumé : cette page ne peut pas importer un fichier de l'application, et
#: quatre valeurs figées valent mieux qu'une dépendance de construction entre
#: le serveur et le dépôt de dessin. Elles ne bougeront pas sans qu'on le sache
#: — la page se regarde.
ENCRE = "#17140F"
ENCRE_DOUCE = "#473E31"
FOND = "#F9F8F7"
ACCENT = "#F39120"

_GABARIT = """<!DOCTYPE html>
<html lang="{langue}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{titre}</title>
<style>
  :root {{ color-scheme: light; }}
  html, body {{ margin: 0; padding: 0; background: {fond}; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica,
      Arial, sans-serif;
    color: {encre};
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 24px;
    box-sizing: border-box;
  }}
  main {{ max-width: 26rem; text-align: left; }}
  .marque {{
    font-size: 0.8125rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: {encre_douce};
    margin: 0 0 1.75rem;
  }}
  .point {{ color: {accent}; }}
  h1 {{ font-size: 1.5rem; line-height: 1.3; font-weight: 600; margin: 0 0 0.75rem; }}
  p {{ font-size: 1rem; line-height: 1.6; color: {encre_douce}; margin: 0; }}
</style>
</head>
<body>
<main>
  <p class="marque">BIND<span class="point">.</span></p>
  <h1>{titre}</h1>
  <p>{corps}</p>
</main>
</body>
</html>
"""


def page(*, titre: str, corps: str, locale: Locale) -> str:
    """Une page à un titre et un paragraphe. Tout est échappé.

    **Échappé bien qu'aucune de ces chaînes ne vienne de l'appelant.** Elles
    viennent du catalogue, donc de nous ; mais une page qui n'échappe pas est
    une page où la première valeur interpolée par quelqu'un d'autre passera
    sans que personne n'y pense.
    """
    return _GABARIT.format(
        langue=escape(locale.value),
        titre=escape(titre),
        corps=escape(corps),
        fond=FOND,
        encre=ENCRE,
        encre_douce=ENCRE_DOUCE,
        accent=ACCENT,
    )


def page_de_message(cle: str, locale: Locale) -> str:
    """La page d'un message du catalogue : `{cle}.title` et `{cle}.body`."""
    return page(
        titre=translate(f"{cle}.title", locale=locale),
        corps=translate(f"{cle}.body", locale=locale),
        locale=locale,
    )


def locale_demandee(accept_language: str | None) -> Locale:
    """La langue du navigateur, quand on ne sait pas encore qui lit.

    **Le cas d'échec n'a pas d'utilisateur.** Un jeton inconnu ne désigne
    personne — c'est même toute la raison pour laquelle il est refusé — donc
    `app_user.locale` n'existe pas pour lui. L'en-tête du navigateur est la
    seule indication qui reste, et l'anglais le repli.

    La lecture est volontairement grossière : on cherche un code de langue
    connu dans l'en-tête, sans pondération. Les qualités relatives de
    `Accept-Language` régleraient un arbitrage entre deux langues que nous
    n'avons pas — nous en avons deux, et l'une est le repli.
    """
    if not accept_language:
        return Locale.EN
    entete = accept_language.lower()
    for locale in Locale:
        if locale.value in entete:
            return locale
    return Locale.EN
