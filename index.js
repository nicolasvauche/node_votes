const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());

const db = new sqlite3.Database("./db.sqlite");

// --------------------------
// Helpers
// --------------------------
function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function getOne(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

function exec(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function auth(requiredRole = null) {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    const token =
      header && header.startsWith("Bearer ")
        ? header.slice("Bearer ".length)
        : null;

    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
      const decoded = jwt.verify(token, "SECRET_KEY_SIMPLE");
      req.user = decoded;

      if (requiredRole && decoded.role !== requiredRole) {
        return res.status(403).json({ error: "Forbidden" });
      }

      next();
    } catch (e) {
      res.status(401).json({ error: "Invalid token" });
    }
  };
}

// --------------------------
// Settings
// --------------------------

app.get("/api/settings", async (req, res) => {
  const rows = await query("SELECT key, value FROM settings");
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  res.json(settings);
});

// Admin: toggle registrations
app.post("/api/admin/registrations", auth("admin"), async (req, res) => {
  const value = req.body.value ? "true" : "false";
  await exec("UPDATE settings SET value=? WHERE key='registrationsClosed'", [
    value,
  ]);
  res.json({ success: true, registrationsClosed: value === "true" });
});

// --------------------------
// Auth / Users
// --------------------------

// Register
app.post("/api/register", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const settings = await getOne(
    "SELECT value FROM settings WHERE key='registrationsClosed'"
  );
  if (settings && settings.value === "true") {
    return res.status(403).json({ error: "Registrations are closed" });
  }

  const hashed = await bcrypt.hash(password, 10);

  try {
    await exec(
      "INSERT INTO users (email, password, role, createdAt) VALUES (?, ?, 'user', datetime('now'))",
      [email, hashed]
    );
    res.json({ success: true });
  } catch (e) {
    // Contrainte d'unicité sur email
    return res.status(400).json({ error: "Email already exists" });
  }
});

// Login
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await getOne("SELECT * FROM users WHERE email = ?", [email]);
  if (!user) return res.status(400).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ error: "Invalid credentials" });

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    "SECRET_KEY_SIMPLE",
    { expiresIn: "2h" }
  );

  res.json({ token });
});

// --------------------------
// Votes (sessions) – Admin
// --------------------------

// List all votes with status
app.get("/api/admin/votes", auth("admin"), async (req, res) => {
  const rows = await query(
    "SELECT * FROM votes ORDER BY datetime(createdAt) DESC"
  );
  res.json(rows);
});

// Create a vote (scheduled by default)
app.post("/api/admin/votes", auth("admin"), async (req, res) => {
  const { title, startsAt, endsAt } = req.body;

  if (!title || !startsAt || !endsAt) {
    return res
      .status(400)
      .json({ error: "title, startsAt and endsAt are required" });
  }

  const now = new Date().toISOString();

  const result = await exec(
    `
    INSERT INTO votes (title, startsAt, endsAt, status, createdAt, updatedAt)
    VALUES (?, ?, ?, 'scheduled', ?, ?)
  `,
    [title, startsAt, endsAt, now, now]
  );

  const vote = await getOne("SELECT * FROM votes WHERE id = ?", [
    result.lastID,
  ]);
  res.status(201).json(vote);
});

// Update vote (title / dates only)
app.put("/api/admin/votes/:id", auth("admin"), async (req, res) => {
  const { id } = req.params;
  const { title, startsAt, endsAt } = req.body;

  const existing = await getOne("SELECT * FROM votes WHERE id = ?", [id]);
  if (!existing) return res.status(404).json({ error: "Vote not found" });

  const newTitle = title ?? existing.title;
  const newStartsAt = startsAt ?? existing.startsAt;
  const newEndsAt = endsAt ?? existing.endsAt;
  const now = new Date().toISOString();

  await exec(
    `
    UPDATE votes
    SET title = ?, startsAt = ?, endsAt = ?, updatedAt = ?
    WHERE id = ?
  `,
    [newTitle, newStartsAt, newEndsAt, now, id]
  );

  const updated = await getOne("SELECT * FROM votes WHERE id = ?", [id]);
  res.json(updated);
});

// Delete vote (and its actions)
app.delete("/api/admin/votes/:id", auth("admin"), async (req, res) => {
  const { id } = req.params;

  await exec("DELETE FROM vote_actions WHERE voteId = ?", [id]);
  const result = await exec("DELETE FROM votes WHERE id = ?", [id]);

  if (result.changes === 0) {
    return res.status(404).json({ error: "Vote not found" });
  }

  res.json({ success: true });
});

// Open a vote – only one can be open at a time
app.post("/api/admin/votes/:id/open", auth("admin"), async (req, res) => {
  const { id } = req.params;

  const existing = await getOne("SELECT * FROM votes WHERE id = ?", [id]);
  if (!existing) return res.status(404).json({ error: "Vote not found" });

  // Check that no other vote is open
  const openVote = await getOne(
    "SELECT * FROM votes WHERE status = 'open' AND id != ?",
    [id]
  );
  if (openVote) {
    return res.status(400).json({ error: "Another vote is already open" });
  }

  const now = new Date().toISOString();

  await exec(
    `
    UPDATE votes
    SET status = 'open', updatedAt = ?, closedAt = NULL
    WHERE id = ?
  `,
    [now, id]
  );

  const updated = await getOne("SELECT * FROM votes WHERE id = ?", [id]);
  res.json(updated);
});

// Close a vote
app.post("/api/admin/votes/:id/close", auth("admin"), async (req, res) => {
  const { id } = req.params;

  const existing = await getOne("SELECT * FROM votes WHERE id = ?", [id]);
  if (!existing) return res.status(404).json({ error: "Vote not found" });

  const now = new Date().toISOString();

  await exec(
    `
    UPDATE votes
    SET status = 'closed', updatedAt = ?, closedAt = ?
    WHERE id = ?
  `,
    [now, now, id]
  );

  const updated = await getOne("SELECT * FROM votes WHERE id = ?", [id]);
  res.json(updated);
});

// --------------------------
// Votes – côté utilisateur
// --------------------------

// Get current open vote (ou null si aucun)
app.get("/api/votes/current", async (req, res) => {
  const vote = await getOne("SELECT * FROM votes WHERE status = 'open'");

  if (!vote) {
    return res.json(null);
  }

  // On renvoie aussi le score courant
  const actions = await query(
    "SELECT value, createdAt FROM vote_actions WHERE voteId = ? ORDER BY datetime(createdAt) ASC",
    [vote.id]
  );
  const total = actions.reduce((sum, a) => sum + a.value, 0);

  res.json({
    vote,
    total,
    actions,
  });
});

// Get full list of actions for a vote (pour tracer un graphique)
app.get("/api/votes/:id/actions", async (req, res) => {
  const { id } = req.params;

  const vote = await getOne("SELECT * FROM votes WHERE id = ?", [id]);
  if (!vote) return res.status(404).json({ error: "Vote not found" });

  const actions = await query(
    `
    SELECT id, userId, value, createdAt
    FROM vote_actions
    WHERE voteId = ?
    ORDER BY datetime(createdAt) ASC
  `,
    [id]
  );

  res.json({ vote, actions });
});

// Get final result for a vote
app.get("/api/votes/:id/result", async (req, res) => {
  const { id } = req.params;

  const vote = await getOne("SELECT * FROM votes WHERE id = ?", [id]);
  if (!vote) return res.status(404).json({ error: "Vote not found" });

  const actions = await query(
    "SELECT value FROM vote_actions WHERE voteId = ?",
    [id]
  );
  const total = actions.reduce((sum, a) => sum + a.value, 0);

  res.json({ voteId: id, total, actionsCount: actions.length });
});

// User vote (1 action / jour / vote)
app.post("/api/vote", auth(), async (req, res) => {
  const { value } = req.body; // +1 ou -1

  if (![+1, -1].includes(value)) {
    return res.status(400).json({ error: "Invalid vote value" });
  }

  const vote = await getOne("SELECT * FROM votes WHERE status = 'open'");
  if (!vote) {
    return res.status(400).json({ error: "No open vote" });
  }

  // 1 action par jour pour ce vote et cet utilisateur
  const existing = await getOne(
    `
    SELECT id FROM vote_actions
    WHERE voteId = ?
      AND userId = ?
      AND date(createdAt) = date('now')
  `,
    [vote.id, req.user.id]
  );

  if (existing) {
    return res.status(403).json({ error: "Already voted today for this vote" });
  }

  await exec(
    `
    INSERT INTO vote_actions (voteId, userId, value, createdAt)
    VALUES (?, ?, ?, datetime('now'))
  `,
    [vote.id, req.user.id, value]
  );

  res.json({ success: true });
});

// --------------------------
// Server
// --------------------------
app.listen(3000, () => {
  console.log("API running on http://localhost:3000");
});
