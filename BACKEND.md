# Mode serveur — WarLike Chat

Le prototype historique (`index.html`) reste **local**. Le nouvel écran `online.html` est une interface distincte pour la messagerie multiutilisateur.

## Configuration Cloudflare Pages requise

1. Créer une base de données Cloudflare D1 pour Chat.
2. Exécuter `migrations/0001_chat.sql` sur cette base (production).
3. Associer la base dans les bindings du projet Cloudflare Pages sous le nom exact `CHAT_DB` (et pour la prévisualisation si nécessaire).
4. Redéployer le site et vérifier `/api/health`, puis essayer l'inscription, la connexion et l'envoi avec deux navigateurs différents.

Aucun compte fictif ni mot de passe n'est inclus dans le dépôt. Les comptes sont créés par inscription. Les mots de passe sont dérivés côté serveur avec PBKDF2 SHA-256 (210 000 itérations et sel individuel). Les sessions sont stockées en D1 par empreinte SHA-256 de jeton aléatoire et exposées dans un cookie HttpOnly, Secure et SameSite=Strict. Le client ne stocke pas le mot de passe.

## API

- `GET /api/health` : état du service et de la base.
- `POST /api/register` : inscription (username, password).
- `POST /api/login` : connexion et cookie de session.
- `POST /api/logout` : révocation de session.
- `GET /api/me` : utilisateur de session.
- `GET /api/rooms` : salons publics.
- `GET /api/messages?room=general&after=0` : messages du salon (maximum 100 par requête).
- `POST /api/messages` : message {room,text}, 2 000 caractères maximum.

## Périmètre et limites

Le transport des messages utilise **polling HTTP toutes les trois secondes**, pas des WebSockets. C'est une première version multiutilisateur persistante, pas encore un système temps réel haute capacité.

Avant d'ouvrir la création de comptes au public : ajouter un contrôle anti-abus distribué, quotas d'inscription, modération, récupération de compte, rétention/purge, protection contre les tentatives de connexion et supervision. Le contrôle d'une requête par seconde sur les messages ne remplace pas un rate limiter robuste. Les pages Cloudflare ne deviendront fonctionnelles qu'après la création de la D1 et son binding ; la simple présence du code ne constitue pas une validation de déploiement.
