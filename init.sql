DROP TABLE IF EXISTS users;

DROP TABLE IF EXISTS votes;

DROP TABLE IF EXISTS settings;

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    createdAt TEXT NOT NULL
);

CREATE TABLE votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER NOT NULL,
    value INTEGER NOT NULL,
    createdAt TEXT NOT NULL,
    closedAt TEXT,
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