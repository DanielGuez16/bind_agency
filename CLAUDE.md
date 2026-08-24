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
- **Un décor de test qui pourrait être produit par le code fautif ne prouve rien.** La mutation le dit sans détour : si l'implémentation qu'on redoute rend le même verdict que la bonne sur le montage écrit, le test survit à la mutation et n'a jamais rien éprouvé. Il faut donc au moins un cas où les deux **divergent**, et c'est celui-là qu'on écrit en premier. Six fois en deux jours, trois de chaque côté du projet : un décor qui posait `absence_signalable_a` à `starts_at + 20 min`, c'est-à-dire à la valeur exacte qu'un écran recopiant le délai aurait calculée ; une garde de traduction qui cherchait la clé par sa feuille et se satisfaisait d'un homonyme dans un autre domaine — le vrai défaut du jour passait au vert ; un montage de file du commerce qui portait `needs_human_review: true`, si bien que tous les tests de décision s'exerçaient sur le cas où le salon ne doit précisément plus décider ; un `valid_until` figé à une date qui a fini par passer, et le test affirmait alors qu'un droit périmé ouvre le code de retrait ; le même champ purement omis d'une autre fabrique, où son absence valait « périmé » par accident ; et un test de configuration qui lisait le `.env` de la machine, vert sur le poste qui portait les identifiants et rouge en intégration continue. **Aucun de ces six n'a été trouvé par relecture** — quatre l'ont été par une mutation, deux par la CI. La question à se poser sur chaque montage : *quelle implémentation fausse passerait ce décor ?* Si la réponse est « celle que je viens d'écarter », le décor est à refaire, pas le code
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

`main` est protégée : fusion par PR uniquement, **les quatre jobs verts** —
`api`, `app`, `e2e` et `perimetre` — et à jour, sans contournement
administrateur. La règle est dans le dépôt, pas dans la vigilance.

**Quatre, et le compte a déjà été faux deux fois.** Cette phrase a dit « `api`
et `app` » longtemps après l'arrivée de la e2e, puis « les trois » après celle
de `perimetre`. La première fois a coûté une PR fusionnée sur une e2e rouge —
un test asservi à un `testID` retiré par la PR elle-même — sans que rien ne s'y
oppose. La seconde s'est vue autrement : `gh pr merge` a refusé avec « 4 of 4
required status checks are expected » alors que ce fichier en annonçait trois,
et il a fallu interroger la protection pour savoir lequel manquait.

Une règle écrite en dessous de ce qu'on attend réellement ne protège que ce
qu'elle écrit — et une règle écrite **au-dessus** de ce qui existe fait chercher
un job qui n'est pas là. Le compte ne se retient donc pas, il se demande : la
commande est plus bas, sous « ce que la protection exige se vérifie ».

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
automatique ne l'attend alors pas. C'est aussi la seule réponse à « 4 of 4
required status checks are expected » quand ce fichier en annonce un autre
nombre — le dépôt a raison, le texte vieillit :

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

**La suite complète une fois, avant de pousser. Pas douze.** Elle coûte sept
minutes ; la lancer à chaque étape d'une tranche en coûtait une heure et demie,
la moitié du temps total mesuré sur une session. Pendant le travail, les
fichiers touchés suffisent — ils tournent en quelques secondes et disent la même
chose de ce qu'on vient d'écrire. La suite entière répond à une autre question :
« ai-je cassé ailleurs », et cette question ne se pose qu'une fois, au moment de
pousser.

**Un fichier en pure suppression se regarde avant de pousser.** La commande
coûte une seconde :

```
git diff --diff-filter=D --name-only origin/main...HEAD
```

**Et non `--numstat` avec un filtre sur les lignes.** C'était la première forme
écrite ici, et elle est fausse : « zéro ligne ajoutée, des lignes retirées »
attrape aussi bien un fichier supprimé qu'un commit qui **ne fait que retirer des
lignes** — un nettoyage de table de garde, une clé de traduction devenue
orpheline. Elle a crié au loup sur deux commits légitimes dans l'heure qui a
suivi son écriture. `--diff-filter=D` ne nomme que ce qui n'existe plus, et une
vérification qui se trompe est pire qu'une vérification absente : elle apprend à
ignorer le rouge.

Un fichier entièrement retiré par une PR qui prétend ajouter est presque
toujours un accident, et **rien d'autre ne le dira**. Un test supprimé ne rougit
pas : il disparaît avec le code qu'il éprouvait, la suite reste verte, et `main`
porte un écran amputé que personne ne voit. Mesuré deux fois en une journée —
vingt-six lignes de `TASKS.md` effacées par une PR, puis quatre cent trente-cinq
lignes d'une PR fusionnée quatre heures plus tôt : deux modules, leur test et
leurs six chaînes de traduction. Découvert deux jours après, par un `tsc` qui
réclamait un module absent.

La cause n'est pas une résolution de conflit, contrairement à ce qu'on suppose
d'abord. `git reset --soft origin/main` suivi de `git add -A` suffit : le reset
déplace HEAD sur le **nouveau** `origin/main` en gardant l'arbre de travail,
lequel porte encore l'état d'avant pour tout ce qu'on n'a pas touché — le
`git add -A` enregistre alors le retrait de tout ce qui a été fusionné entre
les deux. Cela emporte donc des fichiers qu'on n'a jamais ouverts, et plus on
livre vite, plus la fenêtre est large. La forme juste :

```
git reset --soft "$(git merge-base HEAD origin/main)"
```

**Et un conflit sur `TASKS.md` se résout en gardant les deux côtés.** Le fichier
est une liste, pas un état : deux sessions y ajoutent des lignes différentes, et
aucune n'a de raison d'écraser l'autre. C'est le canal par lequel les demandes de
champs passent d'une conversation à l'autre — une demande effacée ne revient pas,
et personne ne s'aperçoit de son absence.

**Mais une décision tranchée *remplace* sa version antérieure, elle ne s'ajoute
pas dessous.** Garder les deux côtés vaut pour deux entrées différentes. Quand
les deux portent **la même** entrée à deux stades — le problème posé, puis la
décision rendue — la version périmée reste sous sa remplaçante, et c'est celle-là
qu'on lit : elle est plus haut dans le fichier une fois sur deux, et elle est
souvent restée décochée.

Le coût n'est pas cosmétique. Ce fichier est le canal entre quatre
conversations : **une copie décochée d'une décision prise fait refaire un
arbitrage déjà rendu.** Mesuré deux fois — trois blocs dupliqués découverts d'un
coup, dont la règle des sept jours du bandeau de mise en ligne, tranchée depuis
des jours et rouverte pour rien parce que la copie lue disait « en attendant ».

Donc : en cochant une entrée, chercher la version qu'elle remplace et la
retirer. Le titre suffit à la trouver — c'est ce que la garde
`tasks-sans-doublons` fait, et elle tombe sur une jumelle avant qu'on la
fusionne. Ce qui mérite d'être gardé de la version d'avant — un diagnostic qui
s'est révélé faux, une cause qu'on a mis longtemps à voir — va dans
`DECISIONS.md`, dont c'est le rôle. `TASKS.md` porte du travail, pas son
histoire.

**Un garde-fou qui coûte plus que ce qu'il protège se retire.** La garde de
durée en est l'exemple, et elle a été retirée : quatre CI rouges en une soirée,
deux heures d'attente, et rien trouvé d'autre qu'elle-même. D'abord calibrée sur
ma machine — dix secondes de plafond, un runner six fois plus lent, un test à
10,2 s qui en met 1,5 ici ; puis incapable de traverser les processus sous xdist,
où la collecte a lieu dans le worker et le bilan dans le contrôleur.

Ce qu'elle devait attraper — un test qui **attend** au lieu de faire — se voit
dans `--durations`, sans faire échouer personne. Une vérification requise qui se
trompe est pire qu'une vérification absente : elle apprend à ignorer le rouge.

Ne pas réécrire un fichier entier pour changer trois lignes. Modifications ciblées.

Ne pas anticiper les phases suivantes. Si une tâche future rend l'implémentation actuelle plus simple, le signaler plutôt que de l'implémenter en avance.
