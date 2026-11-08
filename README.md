# WarLike Chat

Messagerie de salons WarLike connectée à WarLike Server. Les comptes et sessions sont vérifiés par le serveur commun ; les messages partagés sont enregistrés dans une base D1 dédiée.

La page d’accueil ouvre le chat en ligne. Le prototype hors ligne reste disponible sur `/local` et conserve les données locales du navigateur. L’actualisation des salons utilise un polling HTTP de trois secondes.

Le propriétaire peut retirer un message depuis le chat. Les nouveaux chargements masquent les messages retirés ; les autres utilisateurs déjà connectés peuvent devoir recharger la page. La modération centralisée depuis Tower, les messages privés, les appels et les visioconférences restent à développer.

Les comptes standards sont fournis par WarLike Server. Les adresses de chat ne sont pas des adresses e-mail Internet. Les échanges de deux comptes sur le déploiement Cloudflare doivent encore être vérifiés.
