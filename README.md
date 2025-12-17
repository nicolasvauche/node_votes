# Mini API – Gestion des Utilisateurs & Votes

Node.js / Express / SQLite  
Licence : GPL v3

Cette API fournit :

- un système d’inscription / connexion,
- des rôles `user` et `admin`,
- un système de vote limité (1 vote par jour),
- des actions réservées aux admins (fermer les inscriptions, clôturer et réinitialiser les votes).

---

## Arborescence du projet

mini-api/  
├── db.sqlite  
├── init.sql  
├── server.js  
├── package.json  
└── README.md

---

## Initialisation de la base SQLite

npm run init-db

---

## Lancer l’API

Mode normal :  
npm start

Mode développement (auto-reload) :  
npm run dev

API dispo sur : http://localhost:3000

---

## Fonctionnalités

- Inscription utilisateurs
- Connexion + JWT
- Rôles : `user` / `admin`
- Vote : +1 ou -1, limité à un vote par jour
- Admin : fermer les inscriptions
- Admin : clôturer les votes (ajout d’un `closedAt`)
- Admin : réinitialiser les votes (suppression totale)

---

## Endpoints

### Utilisateurs / Auth

POST /register → inscription (si inscriptions ouvertes)  
POST /login → connexion + JWT  
GET /settings → état global

### Votes

POST /vote → vote utilisateur (1/jour)  
GET /votes → liste brute des votes

### Administrateur

POST /admin/registrations → ouvrir / fermer les inscriptions  
POST /admin/close-votes → clôturer les votes  
POST /admin/reset-votes → supprimer tous les votes

---

## Notes

- Projet pédagogique volontairement minimaliste
- Mots de passe hashés avec bcrypt
- JWT simple à renforcer en prod
- SQLite suffit pour une démo ou un prototype

---

## Licence

GPL v3 — Les versions modifiées doivent conserver la même licence.

---

## Contributions

Améliorations et suggestions bienvenues !
