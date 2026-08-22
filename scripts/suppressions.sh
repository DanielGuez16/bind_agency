#!/usr/bin/env bash
#
# Nomme les fichiers dont une branche retire des lignes sans en ajouter.
#
# **Ce que ça répare.** Trois PR ont supprimé du travail qu'elles ne touchaient
# pas — trente et une lignes d'un fichier de tâches, six clés de traduction, et
# trois fichiers source livrés deux heures plus tôt par une autre session. Rien
# ne l'a signalé : la suite était verte, parce que les tests étaient partis avec
# le code qu'ils éprouvaient. Une suppression complète et cohérente ne casse
# rien, et c'est ce qui la rend invisible.
#
# **Ça nomme, ça n'interdit pas.** Une suppression délibérée est un geste normal ;
# ce qui manquait n'était pas une interdiction mais un endroit où la voir. Le
# script sort donc toujours à zéro, et se contente d'annoter.
#
# **La comparaison se fait sur la base de fusion avec la cible, jamais sur le
# parent du commit.** Un parent peut être n'importe quel point de l'histoire —
# c'est même la cause du défaut d'origine, une mise au propre qui rebasait HEAD
# sur une tête plus récente que son arbre de travail. La forme à trois points
# demande « qu'est-ce que cette branche change », qui est la question du
# relecteur.
#
# Les renommages sont détectés et ne comptent pas : un fichier déplacé n'est pas
# un fichier perdu.
set -u

nommer() {
  local base="${1:-origin/main}" tete="${2:-HEAD}"
  git diff --numstat --find-renames "$base...$tete" \
    | awk '$1 == 0 && $2 > 0 { print $2 "\t" $3 }'
}

# ---------------------------------------------------------------------------
# L'épreuve de la garde, sur un dépôt fabriqué pour elle
# ---------------------------------------------------------------------------
#
# **Les témoins réels ne suffisaient pas, et c'est la mutation qui l'a dit.**
# Éprouvée sur la PR qui a effacé la tournée, la garde survivait à deux
# sabotages : remplacer la base de fusion par le parent du commit, et retirer la
# détection des renommages. La raison est que ce témoin est un commit de
# *squash* — son parent **est** la cible, et une branche à un seul commit ne
# distingue pas les deux comparaisons. Un décor que l'implémentation fautive
# rend identique ne prouve rien.
#
# Ce dépôt fabrique donc les trois cas où elles divergent :
#
# 1. une branche à **deux** commits dont la suppression est dans le premier —
#    le parent de la tête ne la voit pas, la base de fusion oui ;
# 2. un **renommage** pur — vu comme une suppression si le suivi est retiré ;
# 3. un fichier **modifié** — des lignes retirées et d'autres ajoutées, qui ne
#    doit jamais être nommé, sinon la garde accuse toute réécriture.
epreuve() {
  local atelier
  atelier=$(mktemp -d)
  trap 'rm -rf "$atelier"' RETURN

  (
    cd "$atelier" || exit 1
    git init -q -b principale
    git config user.email t@t.t && git config user.name t
    # **Le suivi des renommages est désactivé ici exprès.** Git le fait par
    # défaut depuis 2.9, si bien que retirer `--find-renames` de `nommer` ne
    # changeait rien et que la mutation survivait. Le drapeau n'est pas
    # décoratif pour autant : il rend la garde indépendante d'une configuration
    # ambiante qu'on ne maîtrise pas sur un runner. Le décor l'éprouve donc
    # dans le seul cas où il compte.
    git config diff.renames false

    printf 'un\ndeux\n' > garde.txt
    printf 'ancien\n' > renomme.txt
    printf 'a\nb\n' > modifie.txt
    git add -A && git commit -qm base

    git checkout -q -b travail
    # Le premier commit retire ; le second ne touche pas au même fichier.
    printf 'un\n' > garde.txt
    git commit -qam "retire une ligne"
    git mv renomme.txt renomme-autrement.txt
    printf 'a\nc\n' > modifie.txt
    git commit -qam "renomme et modifie"
  ) || return 1

  # **`nommer` et non une copie de sa commande.** La première version de cette
  # épreuve réécrivait le `git diff` à l'identique : elle passait donc au vert
  # quand on sabotait `nommer`, puisqu'elle n'y touchait pas. Une épreuve qui
  # éprouve un double de ce qu'elle surveille ne surveille rien.
  local vu
  vu=$(cd "$atelier" && nommer principale travail | cut -f2)

  local echecs=0
  case "$vu" in
    *garde.txt*) ;;
    *) echo "épreuve : la suppression du premier commit n'est pas vue" >&2; echecs=1 ;;
  esac
  case "$vu" in
    *renomme*) echo "épreuve : un renommage est pris pour une perte" >&2; echecs=1 ;;
  esac
  case "$vu" in
    *modifie.txt*) echo "épreuve : un fichier réécrit est pris pour une perte" >&2; echecs=1 ;;
  esac
  return "$echecs"
}

# L'aiguillage vient en dernier : en bash un script s'exécute de haut en bas, et
# appeler `epreuve` avant sa définition ne lève pas une erreur de compilation
# mais un « command not found » à l'exécution.
if [ "${1:-}" = "--epreuve" ]; then
  epreuve && echo "épreuve : les trois cas passent"
  exit $?
fi

nommer "$@"
