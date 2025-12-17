# Mini API – Gestion des Utilisateurs & Votes

Node.js / Express / SQLite  
Licence : GPL v3

Cette API fournit :

- un système d’inscription / connexion sécurisé (email unique + hash bcrypt),
- des rôles : `user` et `admin`,
- une gestion avancée des votes :
  - création et planification des votes par l’admin,
  - un seul vote « ouvert » à la fois,
  - actions de vote historisées (+1 ou -1),
  - un clic par jour par utilisateur pour le vote en cours,
  - possibilité de tracer un graphique de l’évolution,
  - récupération du résultat final d’un vote,
- des actions réservées aux admins :
  - créer / modifier / supprimer un vote,
  - ouvrir / fermer un vote,
  - verrouiller les inscriptions,
  - consulter la liste des votes et leurs statuts.

---

## Arborescence du projet

```text
mini-api/
├── db.sqlite
├── init.sql
├── index.js
├── package.json
└── README.md
```

---

## Initialisation de la base SQLite

`npm run db:init`

---

## Lancer l’API

Mode développement (auto-reload) :  
`npm run dev`

Mode normal :  
`npm start`

API dispo sur : http://localhost:3000

---

## Fonctionnalités

### Utilisateurs

- Inscription (email unique)
- Connexion (JWT)
- Rôle : `user` / `admin`
- Inscription impossible si l’admin a verrouillé l’accès

### Votes (sessions)

- Chaque vote possède :
  - un titre
  - une date de début
  - une date de fin
  - un statut : `scheduled` / `open` / `closed`
- Un seul vote peut être **ouvert** à la fois

### Actions de vote

- Un utilisateur peut voter **+1 ou -1**
- Une seule action par jour et par utilisateur
- Les actions sont historisées → permet d'afficher un graphe ou une timeline
- L’API peut renvoyer :
  - le vote en cours
  - son score cumulé
  - toutes les actions associées
  - le résultat final

### Droits admin

- Créer un vote
- Modifier un vote
- Supprimer un vote
- Ouvrir un vote
- Fermer un vote
- Voir tous les votes + statuts
- Fermer les inscriptions utilisateurs

---

## Endpoints

### Utilisateurs / Auth

POST /api/register → inscription (si inscriptions ouvertes)  
POST /api/login → connexion + JWT  
GET /api/settings → état des paramètres globaux

---

### Votes — côté utilisateur

GET /api/votes/current → renvoie le vote ouvert, son score, et sa timeline  
POST /api/vote → ajoute +1 ou -1 (1 action/jour)  
GET /api/votes/:id/actions → historique complet des actions d’un vote  
GET /api/votes/:id/result → résultat final

---

### Votes — côté admin

GET /api/admin/votes → liste de tous les votes  
POST /api/admin/votes → créer un vote  
PUT /api/admin/votes/:id → modifier un vote  
DELETE /api/admin/votes/:id → supprimer un vote  
POST /api/admin/votes/:id/open → ouvrir un vote (unique vote ouvert)  
POST /api/admin/votes/:id/close → fermer un vote

---

### Paramètres globaux (admin)

POST /api/admin/registrations → ouvrir / fermer les inscriptions

---

### Documentation Swagger

GET /api/docs → Documentation technique de l'API

---

## Notes

- Projet pédagogique minimaliste, non adapté tel quel à la production
- Mots de passe hashés avec bcrypt
- JWT simple → à renforcer dans un vrai contexte
- Aucune ORM volontairement (SQLite + SQL clair)

---

## Licence

GPL v3 — Les versions modifiées doivent conserver la même licence.

---

## Contributions

Suggestions et améliorations bienvenues !
N'hésitez pas à faire un fork et à proposer vos pull requests ;)
