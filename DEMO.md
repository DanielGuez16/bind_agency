# Démonstration

Comment démarrer BIND depuis un dépôt vierge et le parcourir sur un iPhone.

Chaque commande de ce fichier a été lancée. Les durées sont celles mesurées sur
un MacBook, à titre indicatif.

> **Ce que l'app affiche aujourd'hui.** `App.tsx` rend uniquement l'écran de
> santé de l'API. Les écrans créateur, commerce et back office existent, sont
> testés isolément, mais **aucune navigation ne les assemble** — il n'y a ni
> écran de connexion ni routeur. Sur le téléphone, vous verrez donc l'écran de
> santé, et rien d'autre. Le produit se parcourt aujourd'hui **par l'API**
> (`http://localhost:8010/api/v1/docs`). Voir « Ce qui manque » en fin de
> fichier.

---

## 1. Démarrer, depuis un dépôt vierge

Prérequis : **Python 3.12**, **Node 24** (`nvm use`), **Docker**.

```
make install
```

Crée le venv, installe les dépendances Python et Node, et copie les deux
fichiers `.env` depuis leurs exemples. ~20 s.

### Générer les deux clés

**Obligatoire.** Les valeurs d'exemple sont des marque-pages : l'API refuse de
démarrer avec elles — `clé de chiffrement de 30 octets pour
TOKEN_ENCRYPTION_KEY, 32 attendus`. C'est voulu : aucune variable de sécurité
n'a de valeur de repli.

```
cd api
.venv/bin/python -c "import secrets; print(secrets.token_urlsafe(64))"
.venv/bin/python -c "from app.core.encryption import generate_key; print(generate_key())"
cd ..
```

Reporter la première dans `JWT_SECRET_KEY` et la seconde dans
`TOKEN_ENCRYPTION_KEY`, dans **`api/.env`**.

### Poser la base et le jeu de données

```
make seed
```

Démarre Postgres, applique les migrations, **efface la base de développement**
et pose le jeu. ~35 s. La commande refuse de tourner ailleurs qu'en
`ENVIRONMENT=local`, `ci` ou `test`.

Elle finit par :

```
4 commerces, 13 items, 22 plages, 2 exceptions, 10 offres, 5 créateurs,
11 réservations, 7 contreparties, 3 jobs, 14 photos, 3 plans, 2 abonnements.
Mot de passe de tous les comptes : bind-donnees-de-depart-2026
```

### Lancer l'API

```
make dev
```

`http://localhost:8010/api/v1/docs` pour la documentation interactive,
`http://localhost:8010/api/v1/health` pour vérifier que la base répond.

---

## 2. Depuis l'iPhone

### L'API doit écouter sur le réseau, pas seulement en local

`make dev` lie uvicorn à `127.0.0.1` : le téléphone ne l'atteint pas. Utiliser :

```
make dev-lan
```

Elle affiche l'adresse à recopier, par exemple `http://192.168.1.192:8010/api/v1`.
Pour la retrouver à la main : `ipconfig getifaddr en0`.

### La variable à changer

Dans **`app/.env`**, une seule ligne :

```
EXPO_PUBLIC_API_URL=http://192.168.1.192:8010/api/v1
```

Remplacer `192.168.1.192` par l'adresse affichée par `make dev-lan`.

`localhost` fonctionne pour le web et le simulateur iOS ; sur un appareil
physique il désigne le téléphone lui-même, et rien ne répond.

Les variables `EXPO_PUBLIC_` sont **inlinées dans le bundle à la compilation** :
après modification, arrêter et relancer `make app`. Un rechargement à chaud ne
suffit pas.

### Lancer Expo

```
make app
```

Metro sert sur le port 8081. Scanner le QR code avec **l'appareil photo de
l'iPhone** ; Expo Go s'ouvre. Le téléphone et le Mac doivent être sur le même
réseau Wi-Fi.

Si le réseau isole les appareils entre eux — Wi-Fi d'hôtel, réseau invité —
passer par un tunnel :

```
cd app && npx expo start --tunnel
```

Le tunnel ne concerne **que** le bundle Expo. L'API reste à joindre par son
adresse IP : un tunnel Expo ne l'expose pas.

### Si vous ouvrez l'app dans un navigateur

Il faut ajouter l'origine à `CORS_ORIGINS` dans `api/.env` — la liste ne
contient que `http://localhost:8081` et `http://localhost:19006`. En natif,
Expo Go n'envoie pas d'en-tête `Origin` : le CORS ne s'applique pas.

---

## 3. Les comptes

Mot de passe unique pour tous : **`bind-donnees-de-depart-2026`**

Le domaine `bind.example` est réservé par la RFC 2606 — personne ne le possède,
et il passe la validation d'adresse.

### Créateurs

| Adresse | Langue | Paliers | Ce qu'il démontre |
|---|---|---|---|
| `rebecca@bind.example` | en | **3 / 6** | Créatrice confirmée : 64 000 abonnés, score 90, 2 collaborations achevées. C'est elle qui parcourt le fil et réserve |
| `mateo@bind.example` | es | **1 / 6** | Plafonné par son score : 22 000 abonnés ouvriraient plus, mais son score de 3 ferme le haut. Une absence, une non-honoration, une revue humaine à son actif |
| `camila@bind.example` | es | **0 / 6** | Débutante : 640 abonnés, aucun historique. L'écran des paliers doit l'orienter, pas lui montrer une porte sans serrure |
| `sofia@bind.example` | en | **0 / 6** | Compte en vérification : il lui manque le signal de volume. L'écran persistant, daté, sans promesse de délai |
| `nina@bind.example` | en | **0 / 6** | Autorisation expirée : jeton mort, relevé vieux de 21 jours. Les obstacles `account_token_invalid` et `metrics_stale`, avec leurs dates |

### Commerces

| Adresse | Langue | Commerce | Ce qu'il démontre |
|---|---|---|---|
| `ocean@bind.example` | en | Ocean Beauty Studio | Catalogue profond : une gamme « Coloration » à trois variantes, journée coupée à midi. Abonné au plan Studio |
| `wynwood@bind.example` | es | Wynwood Nails & Care | Items **sans réservation** : on se présente quand on veut. Non abonné |
| `brickell@bind.example` | en | Brickell Spa Collective | Une fermeture et une journée aménagée. Abonné au plan Essentiel |
| `havana@bind.example` | es | Havana Glow | **N'a rien composé.** Ni catalogue, ni horaires, ni offre. C'est l'état de tout commerce le jour de son inscription : écran d'activation, catalogue vide, reporting à zéro |

### Administration

| Adresse | Ce qu'il démontre |
|---|---|
| `admin@bind.example` | File d'arbitrage (1 dossier en revue humaine), file des jobs (1 épuisé), gestion des paliers, plans d'abonnement : 3 plans, 2 abonnés, 298 USD de revenu mensuel — le plan annuel n'a pas preneur, ce qui est la vraie question qu'on se pose devant cet écran |

### Ce que le jeu contient par ailleurs

- **Réservations** dans cinq états : en garde, confirmée, consommée, annulée, absence
- **Contreparties** dans cinq états : attendue, soumise, approuvée, nouvelle soumission demandée, non honorée — dont une en deuxième tentative et une en revue humaine à la troisième
- **Dates étalées sur trois semaines**, relatives à aujourd'hui : le reporting a de quoi montrer autre chose qu'une seule journée

---

## 4. Remettre le jeu à zéro

```
make seed
```

**Efface la base de développement** avant d'écrire — elle repart de zéro et
rejoue toutes les migrations. Rejouable autant de fois que voulu.

Les photos déposées sur le disque ne sont pas effacées : elles sont nommées par
l'empreinte de leur contenu, et le jeu repose les mêmes. Pour les supprimer
malgré tout : `rm -rf /tmp/bind-objets`.

Pour tout détruire, conteneur et volume compris :

```
make clean
```

Après quoi il faut refaire `make install`, régénérer les deux clés et `make seed`.

---

## 5. Ce qui est simulé, et se verra

| Ce qui est simulé | Ce que vous verrez |
|---|---|
| **Plateformes sociales** (`SOCIAL_PROVIDER=demo`) | Les abonnés et les publications sont dérivés du pseudonyme, de façon stable. Rattacher un compte depuis l'app ouvrirait une URL `instagram.demo.bind` qui n'existe pas — le jeu de données a déjà fait le parcours pour les cinq créateurs |
| **Photos** | Générées : dégradés doux avec grain, sans texte. De loin elles tiennent leur rôle ; de près ce ne sont pas des photos de salon |
| **Abonnement** (`BILLING_PROVIDER=log`) | Souscrire trace dans les logs sans appeler Stripe, et ne rend **aucune adresse de paiement** — le bouton n'a nulle part où mener. Les abonnements du jeu portent des identifiants `cus_journal_…` reconnaissables |
| **Emails** (`EMAIL_PROVIDER=log`) | Rien n'est envoyé. Les messages apparaissent dans la console de l'API |
| **Extraction de carte** (`MENU_EXTRACTION_PROVIDER=manual`) | N'extrait rien. L'import de carte demande une saisie |
| **Géocodage** (`GEOCODING_PROVIDER=manual`) | Les coordonnées sont celles fournies, jamais calculées depuis une adresse |
| **Preuve de publication** | Seul le niveau 3 — capture d'écran envoyée — fonctionne dans le jeu. Le niveau 2 (récupération depuis une URL) est branché et testé, mais aucune URL du jeu ne pointe vers un vrai média |

Ce qui n'est **pas** simulé : la base, les migrations, les paliers, la
disponibilité, le verrou de réservation, les codes de retrait, la machine à
états, le score de fiabilité, le reporting, le dépôt d'objets sur disque.

---

## 6. Ce qui manque pour aller plus loin

| Ce qui manque | Prérequis |
|---|---|
| **Une app assemblée** | Ni navigation ni écran de connexion. Les 17 écrans existent et sont testés ; il manque le routeur qui les relie et le formulaire qui ouvre une session. C'est du travail d'app, aucun prérequis extérieur |
| Preuve niveau 1 | `fetch_media` sur l'interface de plateforme, qui arrive avec le relevé des publications |
| Dépôt S3 | Des identifiants. `deposer` et `lire` sont les deux seules fonctions à compléter |
| TikTok en vrai | Des identifiants d'application. Le code est écrit ; **non vérifié** |
| Stripe en production | Une entité juridique. Le mode test fonctionne dès qu'une clé `sk_test_…` est posée dans `STRIPE_SECRET_KEY` |
| Snapchat | L'accès partenaire. Rien n'est écrit, délibérément : la fabrique refuse la plateforme plutôt que de rendre un fournisseur muet |
