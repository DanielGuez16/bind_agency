"""Une colonne écrite par la base ne se compare pas à l'heure du processus.

**La cause de l'instabilité, réduite à une règle.** `clock_timestamp()` est
l'horloge de Postgres ; `datetime.now(UTC)` est celle du processus Python. Les
deux dérivent l'une de l'autre de quelques millisecondes, et rien ne les
synchronise. Tant qu'on ne les compare pas, l'écart ne se voit pas.

Il s'est vu deux fois. La contrainte `close_apres_ouverture` a rejeté une
reprise de compte sur **2,7 millisecondes** — ouverture écrite par la base à
`04:23:03.465808`, fermeture écrite par Python à `04:23:03.463118`. Et la boîte
d'envoi sautait des messages déposés puis balayés dans la foulée : dans le futur
pour la requête qui les cherchait.

**Le peigne, et ce qu'il a trouvé.** Quatorze colonnes sont écrites par la base.
Une seule était comparée à une heure Python sur un écart qui peut être nul —
`outbound_message.run_after` — et son jumeau, `job.run_after`, avait la bonne
écriture depuis le début. Les autres comparaisons portent sur des fenêtres de
plusieurs heures ou sur des bornes fournies par l'appelant : quelques
millisecondes n'y décident de rien, et les convertir n'aurait fait que déplacer
du bruit.

**Cette garde ne relit pas le peigne, elle empêche le motif de revenir.**
"""

import pathlib
import re

RACINE = pathlib.Path(__file__).resolve().parents[1] / "app"

#: Les balayages qui prennent « ce qui est dû maintenant ». Ce sont eux qui
#: peuvent lire une ligne écrite l'instant d'avant, donc eux que l'écart d'horloge
#: atteint.
ECHEANCES = ("run_after",)


def _acceptable(ligne: str) -> bool:
    """Une comparaison acceptable, et **pourquoi la présence de `maintenant` ne
    suffit pas**.

    La première version passait toute ligne contenant `maintenant`. Elle laissait
    donc passer `maintenant or datetime.now(UTC)` — la forme exacte du défaut,
    puisque c'est le repli qui décide quand l'appelant ne fournit rien. La
    mutation l'a montré : elle survivait à la garde censée l'attraper.

    L'horloge du processus est donc **disqualifiante en elle-même**, quel que
    soit ce qu'il y a autour.
    """
    if "datetime.now" in ligne or "utcnow" in ligne:
        return False
    return "clock_timestamp" in ligne or "maintenant" in ligne


def test_aucune_echeance_ne_se_compare_a_l_horloge_du_processus() -> None:
    """**Le cas où l'écart peut être nul**, et le seul qui compte.

    Un balayage compare une échéance écrite par la base à « maintenant ». Si ce
    « maintenant » vient du processus, une ligne déposée puis balayée dans la
    même seconde tombe dans l'écart entre les deux horloges.
    """
    fautes = []
    for fichier in sorted(RACINE.rglob("*.py")):
        source = fichier.read_text(encoding="utf-8")
        for colonne in ECHEANCES:
            for ligne in re.findall(rf"^.*\.{colonne}\s*<=.*$", source, re.M):
                if _acceptable(ligne):
                    continue
                fautes.append(f"{fichier.relative_to(RACINE.parent)} : {ligne.strip()}")

    assert not fautes, (
        "une échéance écrite par la base est comparée à l'heure du processus :\n  "
        + "\n  ".join(fautes)
        + "\nUtiliser `sa.func.clock_timestamp()`, ou l'heure que l'appelant fournit."
    )


def test_la_garde_attrape_bien_la_forme_qu_elle_vise() -> None:
    """**Une garde qui lit du texte se vérifie sur le texte qu'elle doit
    attraper.** Sans ceci, une expression trop étroite passerait pour une
    surveillance — c'est arrivé au garde-fou des rendus asynchrones, qui ne
    cherchait l'appel qu'en début de ligne.
    """
    fautif = "                OutboundMessage.run_after <= instant,"
    correct = (
        "                OutboundMessage.run_after <= (maintenant or sa.func.clock_timestamp()),"
    )
    jobs = "Job.run_after <= sa.func.clock_timestamp()"

    #: La forme que la première version laissait passer : elle contient
    #: `maintenant`, et pourtant le repli est l'horloge du processus.
    sournois = "OutboundMessage.run_after <= (maintenant or datetime.now(UTC)),"

    motif = re.compile(r"^.*\.run_after\s*<=.*$", re.M)

    for forme in (fautif, sournois):
        assert motif.search(forme), f"forme non reconnue : {forme}"
        assert not _acceptable(forme), f"forme fautive acceptée : {forme}"

    for forme in (correct, jobs):
        assert _acceptable(forme), f"forme correcte refusée : {forme}"
