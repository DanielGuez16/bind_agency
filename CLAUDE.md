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

Ne pas réécrire un fichier entier pour changer trois lignes. Modifications ciblées.

Ne pas anticiper les phases suivantes. Si une tâche future rend l'implémentation actuelle plus simple, le signaler plutôt que de l'implémenter en avance.
