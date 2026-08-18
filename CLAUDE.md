# CLAUDE.md

Contexte permanent du dépôt. Lire ce fichier, puis `SPEC.md` et `TASKS.md`, avant toute intervention.

---

## Le projet

BIND est une place de marché bilatérale. Des commerces de proximité (beauté et bien-être au lancement, à Miami) offrent des prestations de leur catalogue à des créateurs de contenu locaux, en échange d'une publication vérifiée sur Instagram, TikTok ou Snapchat.

Le créateur ne reçoit jamais d'argent. Il obtient un droit de consommer un item précis chez un commerce précis, débloqué selon un système de paliers.

`SPEC.md` est la source de vérité fonctionnelle. En cas de contradiction entre ce qui est demandé dans un prompt et ce qui est écrit dans `SPEC.md`, signaler la contradiction au lieu de choisir seul.

---

## Structure du dépôt

```
api/                    Backend FastAPI
  app/
    core/               configuration, sécurité, session base
    models/             modèles SQLAlchemy
    schemas/            schémas Pydantic
    services/           logique métier (paliers, disponibilité, score)
    routers/            routes HTTP
    integrations/       adaptateurs par plateforme sociale
    workers/            tâches de fond
  alembic/              migrations
  tests/
app/                    Application Expo (créateur et commerce)
docs/
SPEC.md
TASKS.md
DECISIONS.md
CLAUDE.md
```

La logique métier vit dans `services/`. Les routes ne contiennent pas de règles, elles valident, appellent un service, renvoient. Aucune requête base directement dans un routeur.

---

## Stack et versions

- Python 3.12, FastAPI, SQLAlchemy, Alembic, Pydantic v2
- PostgreSQL. Jamais SQLite, y compris pour les tests : les verrous consultatifs et le comportement transactionnel sont testés
- pytest, ruff
- Node LTS, Expo / React Native, build web activé
- Stripe uniquement pour l'abonnement des commerces

---

## Commandes

```
# backend
cd api
source .venv/bin/activate
uvicorn app.main:app --reload
pytest
alembic revision --autogenerate -m "message"
alembic upgrade head
ruff check .

# app
cd app
npm install
npx expo start
```

---

## Règles non négociables

**Argent**
- Aucune table ne porte de solde en devise appartenant à un créateur
- Aucun transfert de valeur entre deux utilisateurs
- Le prix d'un item est une donnée de reporting, jamais un avoir
- Montants en entiers de centimes, jamais de flottant

**Temps**
- Tout est stocké en UTC, la conversion se fait à l'affichage sur le fuseau du commerce
- Un horodatage fourni par le client n'est jamais utilisé comme preuve, seul le temps serveur fait foi
- `now()` renvoie l'heure d'ouverture de la transaction. Toute colonne qui doit ordonner des événements à l'intérieur d'une même transaction utilise `clock_timestamp()`. Deux cas déjà corrigés : `audit_log.occurred_at`, où « révoqué puis émis » devenait illisible, et `social_metrics_snapshot.captured_at`, où « le dernier relevé » n'avait plus de réponse

**Métier**
- `duration_minutes` est obligatoire sur un item de catalogue, sans elle aucun calcul de capacité n'est possible
- `reliability_score` nul signifie neutre, pas zéro : la condition de score est ignorée, pas échouée
- Une extraction de carte ne crée jamais d'items directement, elle remplit une charge à valider par le commerce
- La disponibilité se calcule à la volée, on ne matérialise pas de lignes de créneaux
- Toute création de réservation passe par un verrou consultatif Postgres, recompte de capacité dans la transaction
- Aucune transition d'état sans écriture dans le journal d'audit

**Configuration**
- Aucun seuil de palier, aucun prix, aucun délai en dur dans le code, tout en configuration
- Jetons OAuth chiffrés au repos
- Anglais et espagnol dès le premier écran, aucune chaîne d'interface écrite en dur

**Tests**
- Un test qui éprouve un refus ne s'arrête jamais au code d'erreur. Il continue d'utiliser la session ensuite. S'arrêter là ne prouve pas que la session est restée saine : une violation attrapée hors d'un point de sauvegarde la laisse inutilisable, et le défaut n'apparaît qu'à l'appel suivant, ailleurs, sous une erreur qui ne dit rien
- Un trigger ou une contrainte se teste en SQL direct, sans passer par le service qu'il double. Vérifié au travers de ce code, il ne prouve rien
- Une contrainte se teste dans les deux sens. Celle qui refuse tout passe le test de refus sans rien garantir
- Le jeu de données de départ ne pose jamais à la main une valeur qu'un mécanisme du produit doit produire. Un profil, un compteur, un score s'obtiennent en appelant le service qui les crée. Une valeur posée directement masque l'absence du mécanisme et rend le jeu de données inutile comme test
- Quand un test vérifie un ensemble vide, se demander si le vide est le bon résultat ou le symptôme
- Un champ accepté par un schéma et ignoré par le service est un défaut, pas une omission : l'appelant reçoit un 200 et croit avoir enregistré. Refuser explicitement vaut mieux qu'ignorer en silence
- **Un test neuf n'est écrit que lorsqu'il a échoué au moins une fois.** Avant de le considérer comme fait, casser délibérément ce qu'il prétend protéger et vérifier qu'il tombe — puis remettre. Quatre fois sur ce projet un test est passé sans rien vérifier : un montage qui posait une clé sans objet, le palier désactivé, le jeu de données, et une assertion `rejects` dont la promesse était jetée. Aucun n'a été trouvé par relecture ; tous l'auraient été par une mutation de trente secondes. Un test qui n'a jamais échoué ne prouve pas que le code marche, il prouve qu'il s'exécute
- **Une garde se vérifie sur les formes qu'elle doit attraper, pas sur celle qu'on avait en tête.** Écrire l'exemple qui a motivé la garde, puis les trois autres façons d'écrire la même faute, et vérifier qu'elle les prend toutes. Le garde-fou des rendus asynchrones ne cherchait l'appel qu'en début de ligne : `const vue = render(…)`, la forme la plus courante, lui a échappé pendant des semaines et a rendu la CI illisible. Une garde partielle est pire qu'aucune — elle fait croire que la question est réglée

---

## Méthode de travail

Une session, une tâche de `TASKS.md`. Pas deux.

1. Lire `SPEC.md` et `TASKS.md`
2. Annoncer le plan avant d'écrire du code, attendre validation si le plan s'écarte de la spec
3. Implémenter
4. Écrire les tests. Couverture réelle exigée sur le moteur de paliers et le calcul de disponibilité. Tests d'intégration légers ailleurs
5. Vérifier que tout passe
6. Cocher la tâche dans `TASKS.md`
7. Ajouter une ligne dans `DECISIONS.md` si une décision technique a été prise, avec la date et la raison

Une branche par tâche, nommée `phase-N/nom-court`.

**Deux à trois points par PR quand ils touchent la même zone.** Une PR par
point coûtait douze minutes d'intégration continue à chaque fois, mesurées :
sept exécutions sur une seule session, quatre-vingt-cinq minutes d'attente pour
moins d'un quart d'heure de calcul réel. Relire un peu plus à chaque fois vaut
mieux qu'attendre six fois.

Ce qui ne se regroupe jamais : une PR qui ne compile pas, et une migration
laissée à moitié. Le regroupement réduit l'attente, il ne réduit pas ce qui doit
être vrai à chaque fusion.

`main` est protégée : fusion par PR uniquement, **les trois jobs verts** — `api`,
`app` et `e2e` — et à jour, sans contournement administrateur. La règle est dans
le dépôt, pas dans la vigilance.

**Les trois, et `e2e` a été ajoutée après les deux autres.** Cette phrase disait
« `api` et `app` » longtemps après l'arrivée de la e2e : elle attrapait déjà ce
que les deux autres ne voient pas, et rien ne l'empêchait de rester rouge. Une
PR a été fusionnée sur une e2e rouge — un test asservi à un `testID` retiré par
la PR elle-même — sans que rien ne s'y oppose. Une règle écrite en dessous de ce
qu'on attend réellement ne protège que ce qu'elle écrit.

**La première question est « la branche est-elle fusionnable », pas « où en est
la CI ».** Une PR en conflit ne reçoit **aucune** exécution : GitHub construit
les runs de `pull_request` sur le commit de fusion, et quand il ne peut pas le
calculer il ne dispatche rien. Rien n'est en attente, rien n'a démarré, et rien
ne le dit.

```
gh pr view <n> --json mergeable,mergeStateStatus
```

`CONFLICTING` explique toute CI qui ne démarre pas — rebaser, l'exécution part
dans la seconde. `UNKNOWN` veut dire « redemande » et non « inconnu » : le
commit de fusion se calcule en tâche de fond et la première réponse arrive
souvent avant lui.

**Cette règle vivait dans `DECISIONS.md`, et deux conversations s'y sont fait
prendre le même jour** — trois quarts d'heure sur la PR #126, puis une seconde
sur la #149, à chercher pourquoi une CI était lente alors qu'aucune n'existait.
Le texte était juste ; il était dans le journal des décisions, que personne ne
lit avant de travailler, et non dans le fichier qu'on lit toujours. Une règle
rangée là où on ne la cherche pas ne protège personne. Elle est donc ici, et
avant les commandes d'attente : on ne peut pas attendre un run qui n'existe pas.

Ce qui la rend coûteuse est ce qu'on voit à la place. `gh pr checks` n'affiche
alors qu'un contrôle tiers absent ou en `skipping`, ce qui se lit comme « en
attente » et non comme « rien n'a tourné ». Le réflexe est de patienter, et
c'est exactement ce qu'il ne faut pas faire.

Le moment où le conflit naît est connu : c'est `main` qui avance sous la
branche. Après chaque `git push --force`, et avant toute attente, poser la
question ci-dessus.

Une fois qu'un run existe, l'état se lit sur **sa conclusion**, jamais sur un
décompte de lignes. `gh pr checks` liste des vérifications sans les résumer : y
compter les `pass` a laissé fusionner sept PR sur une CI rouge. Attendre et
conclure :

```
gh run watch <id> --exit-status
gh run view <id> --json conclusion -q .conclusion
```

Et lire la conclusion **par job** quand une seule ligne suffit à décider :

```
gh run view <id> --json jobs -q '.jobs[] | "\(.name): \(.conclusion)"'
```

**Ce que la protection exige se vérifie, il ne se suppose pas.** Un job ajouté à
la CI n'entre pas de lui-même dans les vérifications requises, et la fusion
automatique ne l'attend alors pas :

```
gh api repos/DanielGuez16/bind_agency/branches/main/protection \
  --jq .required_status_checks.contexts
```

**Commiter avant de muter, sans exception.** L'exercice de mutation restaure
son sabotage par `git checkout` ; sur du travail non commité, la commande efface
le travail lui-même. C'est arrivé deux fois dans la même journée — cinq
corrections de sélecteurs perdues d'un coup la seconde fois, et découvertes
seulement parce qu'une garde restait rouge. Une mutation se prépare donc en deux
temps : on commite ce qu'on vient d'écrire, **puis** on casse. Le `git checkout`
retrouve alors exactement ce qu'on voulait retrouver.

Ne pas réécrire un fichier entier pour changer trois lignes. Modifications ciblées.

Ne pas anticiper les phases suivantes. Si une tâche future rend l'implémentation actuelle plus simple, le signaler plutôt que de l'implémenter en avance.
