# Démonstration

Comment démarrer BIND depuis un dépôt vierge et le parcourir sur un iPhone.

Chaque commande de ce fichier a été lancée. Les durées sont celles mesurées sur
un MacBook, à titre indicatif.

> **Ce que vous verrez en scannant le QR code.** L'écran de connexion. Après
> connexion, l'app vous emmène dans la navigation de votre rôle — les onglets
> ne sont pas les mêmes pour une créatrice, un commerce et un administrateur.
> La session est gardée dans le trousseau de l'appareil : à la deuxième
> ouverture, vous arrivez directement dans vos onglets.

---

## 1. Démarrer, depuis un dépôt vierge

Prérequis : **Python 3.12**, **Node 24** (`nvm use`), **Docker**, et **Expo Go**
sur le téléphone.

L'application est en **Expo SDK 54**. C'est la version qu'Expo Go sert
aujourd'hui sur l'App Store ; un SDK plus récent produirait un QR code
qu'Expo Go refuse d'ouvrir.

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

### L'adresse de l'API : rien à renseigner

L'application la déduit du serveur Expo qui lui a servi son code. Ce serveur
tourne sur le Mac, à côté de l'API, et le téléphone vient d'y accéder : son
adresse est donc juste par construction, et elle suit un changement de réseau
sans qu'on y touche. Sur le web, c'est l'adresse de la page.

Seul le port est fixé — 8081 pour Expo, 8010 pour l'API — parce que rien dans
l'un ne dit l'autre.

L'adresse retenue et son origine s'affichent dans **Settings**, sous
*API address*. C'est là qu'il faut regarder si une page reste vide.

### La variable, pour les cas particuliers

`EXPO_PUBLIC_API_URL` dans **`app/.env`** l'emporte sur la déduction. Elle ne
sert qu'à viser une API ailleurs — autre machine, tunnel, environnement
distant :

```
EXPO_PUBLIC_API_URL=http://192.168.1.192:8010/api/v1
```

Ne jamais y écrire `localhost` pour une démonstration sur téléphone : sur un
appareil physique, il désigne le téléphone lui-même, et rien ne répond.

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

Le bundle iOS pèse ~8 Mo et se construit en une dizaine de secondes la première fois, moins ensuite.

Si le réseau isole les appareils entre eux — Wi-Fi d'hôtel, réseau invité —
passer par un tunnel :

```
cd app && npx expo start --tunnel
```

Le tunnel ne concerne **que** le bundle Expo, et c'est le seul cas où la
variable devient nécessaire : l'adresse déduite serait alors celle du tunnel,
qui n'expose pas l'API. Renseigner `EXPO_PUBLIC_API_URL` avec l'adresse IP du
Mac, et relancer.

### Ce que vous verrez, écran par écran

**Au premier lancement : l'écran de connexion.** Deux champs, et un lien vers
l'inscription. Le bouton n'apparaît qu'une fois l'adresse et un mot de passe de
douze caractères saisis — l'aide sous le champ dit ce qui manque, le griser
demanderait de le deviner.

**Après connexion, la navigation de votre rôle** :

| Compte | Onglets | Premier écran |
|---|---|---|
| `rebecca@bind.example` | Près de vous · Paliers · Réservations · Audience · Réglages | Le fil, qui demande d'abord votre position |
| `ocean@bind.example` | Aujourd'hui · Publications · Rapports · Configuration · Réglages | La journée du comptoir, 8 lignes |
| `admin@bind.example` | Revues · Plans · Réglages | La file d'arbitrage, 1 dossier |

Le **thème suit le rôle** : sombre côté créateur, clair côté commerce et
administration, avec le liseré ocre en haut des écrans commerce. Il se force
depuis les réglages, sans changer la densité.

**Onglet Près de vous** : l'app demande la position au premier affichage.
Refuser n'est pas une panne — l'écran continue de proposer. Le jeu de données
est à Miami ; depuis ailleurs, le fil sera vide et le dira.

**Réglages** contient la langue, le thème, le diagnostic de connexion et la
déconnexion. L'écran de santé y est relégué : il répond à « est-ce que ça
marche », question qu'on se pose quand ça ne marche pas.

**Une session expirée ou un compte suspendu** ramène à la connexion avec un
message qui dit lequel des deux, jamais un écran blanc.

### Si vous ouvrez l'app dans un navigateur

```
cd app && npx expo start --web
```

L'origine doit figurer dans `CORS_ORIGINS` (`api/.env`) — la liste par défaut
contient `http://localhost:8081` et `http://localhost:19006`, ce qui couvre le
cas courant. En natif, Expo Go n'envoie pas d'en-tête `Origin` : le CORS ne
s'applique pas.

### Si aucune adresse n'est trouvée

Le cas ne survient que dans une application compilée, sans serveur Expo à
interroger. L'application affiche alors un écran qui le dit et nomme la
variable, plutôt qu'une erreur de connexion. Les variables `EXPO_PUBLIC_` étant
inlinées à la compilation, il faut **relancer le serveur Expo** après l'avoir
renseignée.

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

## 3 bis. Rattacher un compte Instagram réel

Le jeu de données pose des comptes sociaux **simulés**. Pour brancher un vrai
compte Instagram, il faut d'abord que l'API soit en mode réel.

### La variable qui bascule

Dans `api/.env`, une seule ligne, et deux valeurs possibles :

```
SOCIAL_PROVIDER=demo   # fournisseur simulé, chiffres dérivés du pseudonyme
SOCIAL_PROVIDER=live   # vraies requêtes chez Meta et TikTok
```

`instagram` n'est pas une valeur acceptée : l'API refuse de démarrer, en
nommant le champ. Il faut aussi `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` et
`INSTAGRAM_REDIRECT_URI`, cette dernière **identique** à celle déclarée dans
l'application Meta.

En `live`, le jeu de données continue de fonctionner : il construit ses propres
fournisseurs simulés et ne passe pas par ce réglage.

### Les permissions demandées

Une seule : `instagram_business_basic`. Elle suffit à lire l'identifiant, le
pseudonyme, le nombre d'abonnés, d'abonnements et de publications — tout ce que
le produit utilise. Aucune permission de messagerie, de commentaire ni de
publication n'est demandée : celles-ci apparaissent dans les URL d'exemple
générées par le tableau de bord Meta, pas dans celle que l'API compose.

Pour vérifier ce qui part réellement :

```
curl -s -X POST http://<ip>:8010/api/v1/me/social-accounts/instagram/connect \
  -H "authorization: Bearer <jeton>" -H 'content-type: application/json' \
  -d '{"return_url":"exp://<ip>:8081/--/oauth"}'
```

Le paramètre `scope` de l'URL rendue doit valoir `instagram_business_basic`, et
rien d'autre.

### Où cliquer, et ce que vous devez voir

1. **Onglet Audience**, en bas de l'écran. Sous la liste des comptes :
   *Connect a network*, puis deux boutons, **Instagram** et **TikTok**.
   À l'inscription, le même choix est proposé sur l'écran d'accueil.
2. Toucher **Instagram**. Une vue navigateur s'ouvre **par-dessus l'app**, sur
   `instagram.com` — ce n'est pas Safari, l'app reste dessous.
3. Se connecter, autoriser. La page d'autorisation ne doit demander que
   l'accès au profil et aux statistiques.
4. Instagram renvoie sur le tunnel, l'API échange le jeton, rattache le compte
   et **redirige vers l'app**. La vue navigateur **se referme toute seule**.
5. L'écran Audience se recharge et montre le compte : pseudonyme, abonnés,
   publications, et la date du relevé.

Si la vue ne se referme pas, c'est que la redirection n'a pas abouti — voir
plus bas.

### Les comptes du jeu de données ne survivent pas au changement de mode

Le jeu pose des comptes **simulés** : leurs jetons n'existent chez personne. En
passant `SOCIAL_PROVIDER=live`, ces comptes deviennent irrécupérables — ni
relevé, ni renouvellement, ni reconnexion, parce qu'il n'y a rien à reconnecter.

L'app le dit sur le compte concerné, dans **Audience** : « This account came
from demonstration mode and cannot be reconnected. » L'issue est de rattacher un
compte réel, pas de reconnecter celui-là — le faire créerait un autre compte et
laisserait le premier mort à côté.

Chaque compte porte donc le mode sous lequel il a été rattaché. Le mode vient du
fournisseur qui l'a créé, pas du réglage du jour : le jeu de données construit
ses fournisseurs simulés même quand la configuration dit « live ».

### Le retour dans l'app, et pourquoi il n'allait pas de soi

Le rappel d'Instagram arrive sur le **tunnel**, côté serveur. L'app tourne sur
le téléphone, à une autre adresse : rien ne la ramène toute seule, et la
première version terminait le parcours sur une réponse JSON affichée dans le
navigateur — le compte était rattaché, l'app ne le savait jamais.

L'app dit donc au serveur où revenir. Elle envoie son adresse
(`exp://<ip>:8081/--/oauth` sous Expo Go), le serveur la garde avec l'état
OAuth et **redirige dessus** une fois le compte rattaché. La vue navigateur
surveille cette adresse et se referme en la voyant.

L'adresse de retour est contrôlée à l'ouverture, contre une liste fermée de
schémas (`exp`, `bind`) : une adresse arbitraire suivie sans contrôle ferait de
ce rappel une redirection ouverte.

**Ce qui ne marche pas en Expo Go, et ce qu'il faut savoir :**

- Le tunnel `cloudflared` change d'adresse à chaque redémarrage. Il faut alors
  mettre à jour `INSTAGRAM_REDIRECT_URI` **et** l'URI déclarée chez Meta, puis
  relancer l'API. Une seule des deux suffit à casser le parcours, avec un
  message qui vient de Meta et ne dit pas laquelle.
- Si vous lancez Expo **en mode tunnel** (`npx expo start --tunnel`), l'adresse
  de retour devient celle du tunnel Expo, que le serveur refuse. Rester en
  `--host lan` pour ce parcours.
- Le compte Instagram doit être **professionnel ou créateur**, et inscrit comme
  testeur de l'application Meta tant qu'elle est en développement. Un compte
  personnel est refusé par Meta, avec un message à eux.

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
| Envoi d'une preuve | L'écran existe et montre son état ; le bouton d'envoi n'ouvre pas encore de sélecteur de média |
| Écrans commerce de composition | Catalogue, horaires et capacité se pilotent par l'API. Les routes existent, les écrans non |
| Choix entre deux commerces | La navigation prend le premier commerce de l'utilisateur. Personne n'en a deux dans le jeu ; le sélecteur viendra avec le cas |
| Preuve niveau 1 | `fetch_media` sur l'interface de plateforme, qui arrive avec le relevé des publications |
| Dépôt S3 | Des identifiants. `deposer` et `lire` sont les deux seules fonctions à compléter |
| TikTok en vrai | Des identifiants d'application. Le code est écrit ; **non vérifié** |
| Stripe en production | Une entité juridique. Le mode test fonctionne dès qu'une clé `sk_test_…` est posée dans `STRIPE_SECRET_KEY` |
| Snapchat | L'accès partenaire. Rien n'est écrit, délibérément : la fabrique refuse la plateforme plutôt que de rendre un fournisseur muet |
