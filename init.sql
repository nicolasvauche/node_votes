DROP TABLE IF EXISTS vote_actions;

DROP TABLE IF EXISTS votes;

DROP TABLE IF EXISTS users;

DROP TABLE IF EXISTS settings;

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    createdAt TEXT NOT NULL
);

CREATE TABLE votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    startsAt TEXT NOT NULL,
    endsAt TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN ('scheduled', 'open', 'closed')
    ),
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    closedAt TEXT
);

CREATE TABLE vote_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voteId INTEGER NOT NULL,
    userId INTEGER NOT NULL,
    value INTEGER NOT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (voteId) REFERENCES votes (id),
    FOREIGN KEY (userId) REFERENCES users (id)
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT INTO
    settings (key, value)
VALUES (
        'registrationsClosed',
        'false'
    );

-- --------------------------------------
-- Admin pré-enregistré
-- email : admin@example.com
-- password : admin
-- --------------------------------------

INSERT INTO
    users (
        email,
        password,
        role,
        createdAt
    )
VALUES (
        'admin@example.com',
        '$2b$10$gHsuYyrPjdvVSxGInxje1uY61zIYEMPEP5fnCVfT1k4NXi3Da6XH2',
        'admin',
        datetime('now')
    );