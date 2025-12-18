const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const path = require("path");

const app = express();
app.use(cors({ origin: "http://localhost:5173", credentials: true }));
app.use(bodyParser.json());
app.use(cookieParser());

const db = new sqlite3.Database(path.join(__dirname, "db.sqlite"));
const swaggerDocument = YAML.load("./openapi.yaml");

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
    const tokenFromCookie = req.cookies?.token;
    const header = req.headers.authorization;
    const tokenFromHeader =
      header && header.startsWith("Bearer ")
        ? header.slice("Bearer ".length)
        : null;

    const token = tokenFromCookie || tokenFromHeader;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
      const decoded = jwt.verify(token, "SECRET_KEY_SIMPLE");
      req.user = decoded;

      if (requiredRole && decoded.role !== requiredRole) {
        return res.status(403).json({ error: "Forbidden" });
      }

      next();
    } catch {
      res.status(401).json({ error: "Invalid token" });
    }
  };
}

function attachUserIfAny(req) {
  const tokenFromCookie = req.cookies?.token;
  const header = req.headers.authorization;
  const tokenFromHeader =
    header && header.startsWith("Bearer ")
      ? header.slice("Bearer ".length)
      : null;

  const token = tokenFromCookie || tokenFromHeader;
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, "SECRET_KEY_SIMPLE");
    req.user = decoded;
    return decoded;
  } catch {
    return null;
  }
}

// --------------------------
// Bootstrap admin
// --------------------------

async function ensureAdmin() {
  const email = "admin@example.com";
  const password = "admin";

  const existing = await getOne("SELECT id FROM users WHERE email = ?", [
    email,
  ]);

  if (existing) {
    console.log("ℹ️ Admin already exists");
    return;
  }

  const hash = await bcrypt.hash(password, 10);

  await exec(
    "INSERT INTO users (email, password, role, createdAt) VALUES (?, ?, 'admin', datetime('now'))",
    [email, hash]
  );

  console.log("✅ Admin created:", email);
}

// --------------------------
// Settings
// --------------------------

app.get("/api/settings", async (req, res) => {
  const rows = await query("SELECT key, value FROM settings");
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

app.post("/api/admin/registrations", auth("admin"), async (req, res) => {
  const value = req.body.value ? "true" : "false";
  await exec("UPDATE settings SET value=? WHERE key='registrationsClosed'", [
    value,
  ]);
  res.json({ success: true, registrationsClosed: value === "true" });
});

// --------------------------
// Auth
// --------------------------

app.post("/api/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password are required" });

  const settings = await getOne(
    "SELECT value FROM settings WHERE key='registrationsClosed'"
  );
  if (settings?.value === "true")
    return res.status(403).json({ error: "Registrations are closed" });

  const hash = await bcrypt.hash(password, 10);

  try {
    await exec(
      "INSERT INTO users (email, password, role, createdAt) VALUES (?, ?, 'user', datetime('now'))",
      [email, hash]
    );
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "Email already exists" });
  }
});

app.post("/api/login", async (req, res) => {
  const email = req.body.email?.trim().toLowerCase();
  const password = req.body.password?.trim();

  const user = await getOne("SELECT * FROM users WHERE email = ?", [email]);
  if (!user) return res.status(400).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ error: "Invalid credentials" });

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    "SECRET_KEY_SIMPLE",
    { expiresIn: "2h" }
  );

  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 2 * 60 * 60 * 1000,
  });

  res.json({
    success: true,
    user: { id: user.id, email: user.email, role: user.role },
  });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ success: true });
});

// --------------------------
// Votes (Admin)
// --------------------------

app.get("/api/admin/votes", auth("admin"), async (req, res) => {
  const votes = await query(
    "SELECT * FROM votes ORDER BY datetime(createdAt) DESC"
  );
  res.json(votes);
});

app.post("/api/admin/votes", auth("admin"), async (req, res) => {
  const { title, startsAt, endsAt } = req.body;

  if (!title || !startsAt || !endsAt) {
    return res.status(400).json({ error: "Invalid data" });
  }

  const r = await exec(
    `INSERT INTO votes (title, startsAt, endsAt, status, createdAt, updatedAt, closedAt)
     VALUES (?, ?, ?, 'scheduled', datetime('now'), datetime('now'), NULL)`,
    [title, startsAt, endsAt]
  );

  const vote = await getOne("SELECT * FROM votes WHERE id = ?", [r.lastID]);
  res.status(201).json(vote);
});

app.put("/api/admin/votes/:id", auth("admin"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id))
    return res.status(400).json({ error: "Invalid id" });

  const { title, startsAt, endsAt } = req.body;

  const existing = await getOne("SELECT * FROM votes WHERE id = ?", [id]);
  if (!existing) return res.status(404).json({ error: "Vote not found" });

  await exec(
    `UPDATE votes
     SET title = COALESCE(?, title),
         startsAt = COALESCE(?, startsAt),
         endsAt = COALESCE(?, endsAt),
         updatedAt = datetime('now')
     WHERE id = ?`,
    [title ?? null, startsAt ?? null, endsAt ?? null, id]
  );

  const vote = await getOne("SELECT * FROM votes WHERE id = ?", [id]);
  res.json(vote);
});

app.delete("/api/admin/votes/:id", auth("admin"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id))
    return res.status(400).json({ error: "Invalid id" });

  const existing = await getOne("SELECT id FROM votes WHERE id = ?", [id]);
  if (!existing) return res.status(404).json({ error: "Vote not found" });

  await exec("DELETE FROM vote_actions WHERE voteId = ?", [id]);
  await exec("DELETE FROM vote_positions WHERE voteId = ?", [id]);
  await exec("DELETE FROM votes WHERE id = ?", [id]);

  res.json({ success: true });
});

app.post("/api/admin/votes/:id/open", auth("admin"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id))
    return res.status(400).json({ error: "Invalid id" });

  const existing = await getOne("SELECT * FROM votes WHERE id = ?", [id]);
  if (!existing) return res.status(404).json({ error: "Vote not found" });

  const otherOpen = await getOne(
    "SELECT id FROM votes WHERE status = 'open' AND id != ? LIMIT 1",
    [id]
  );
  if (otherOpen) {
    return res.status(400).json({ error: "Another vote is already open" });
  }

  await exec(
    `UPDATE votes
     SET status = 'open',
         updatedAt = datetime('now'),
         closedAt = NULL
     WHERE id = ?`,
    [id]
  );

  const vote = await getOne("SELECT * FROM votes WHERE id = ?", [id]);
  res.json(vote);
});

app.post("/api/admin/votes/:id/close", auth("admin"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id))
    return res.status(400).json({ error: "Invalid id" });

  const existing = await getOne("SELECT * FROM votes WHERE id = ?", [id]);
  if (!existing) return res.status(404).json({ error: "Vote not found" });

  await exec(
    `UPDATE votes
     SET status = 'closed',
         updatedAt = datetime('now'),
         closedAt = datetime('now')
     WHERE id = ?`,
    [id]
  );

  const vote = await getOne("SELECT * FROM votes WHERE id = ?", [id]);
  res.json(vote);
});

// --------------------------
// Votes (User)
// --------------------------

app.get("/api/votes/current", async (req, res) => {
  attachUserIfAny(req);

  const vote = await getOne(
    "SELECT * FROM votes WHERE status = 'open' ORDER BY datetime(updatedAt) DESC LIMIT 1"
  );

  if (!vote) return res.json({});

  const totalRow = await getOne(
    "SELECT COALESCE(SUM(value), 0) AS total FROM vote_positions WHERE voteId = ?",
    [vote.id]
  );

  let myVote = null;
  if (req.user?.id) {
    const row = await getOne(
      "SELECT value FROM vote_positions WHERE voteId = ? AND userId = ?",
      [vote.id, req.user.id]
    );
    myVote = row ? Number(row.value) : 0;
  }

  const actions = await query(
    "SELECT value, createdAt FROM vote_actions WHERE voteId = ? ORDER BY datetime(createdAt) ASC",
    [vote.id]
  );

  res.json({
    vote,
    total: Number(totalRow?.total ?? 0),
    myVote,
    actions,
  });
});

app.get("/api/votes/:id/actions", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id))
    return res.status(400).json({ error: "Invalid id" });

  const vote = await getOne("SELECT * FROM votes WHERE id = ?", [id]);
  if (!vote) return res.status(404).json({ error: "Vote not found" });

  const actions = await query(
    "SELECT * FROM vote_actions WHERE voteId = ? ORDER BY datetime(createdAt) ASC",
    [id]
  );

  res.json({ vote, actions });
});

app.get("/api/votes/:id/result", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id))
    return res.status(400).json({ error: "Invalid id" });

  const vote = await getOne("SELECT id FROM votes WHERE id = ?", [id]);
  if (!vote) return res.status(404).json({ error: "Vote not found" });

  const row = await getOne(
    `SELECT
        COALESCE(SUM(value), 0) AS total,
        COUNT(*) AS votersCount
     FROM vote_positions
     WHERE voteId = ?`,
    [id]
  );

  res.json({
    voteId: id,
    total: Number(row?.total ?? 0),
    votersCount: Number(row?.votersCount ?? 0),
  });
});

app.post("/api/vote", auth(), async (req, res) => {
  const value = Number(req.body?.value);
  if (value !== 1 && value !== -1 && value !== 0) {
    return res.status(400).json({ error: "Invalid vote value" });
  }

  const currentVote = await getOne(
    "SELECT * FROM votes WHERE status = 'open' ORDER BY datetime(updatedAt) DESC LIMIT 1"
  );

  if (!currentVote) {
    return res.status(400).json({ error: "No open vote" });
  }

  const existingPos = await getOne(
    "SELECT id FROM vote_positions WHERE voteId = ? AND userId = ?",
    [currentVote.id, req.user.id]
  );

  if (!existingPos) {
    await exec(
      `INSERT INTO vote_positions (voteId, userId, value, createdAt, updatedAt)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
      [currentVote.id, req.user.id, value]
    );
  } else {
    await exec(
      `UPDATE vote_positions
       SET value = ?, updatedAt = datetime('now')
       WHERE voteId = ? AND userId = ?`,
      [value, currentVote.id, req.user.id]
    );
  }

  await exec(
    `INSERT INTO vote_actions (voteId, userId, value, createdAt)
     VALUES (?, ?, ?, datetime('now'))`,
    [currentVote.id, req.user.id, value]
  );

  const totalRow = await getOne(
    "SELECT COALESCE(SUM(value), 0) AS total FROM vote_positions WHERE voteId = ?",
    [currentVote.id]
  );

  res.json({
    success: true,
    total: Number(totalRow?.total ?? 0),
    myVote: value,
  });
});

// --------------------------
// Swagger
// --------------------------

app.use(
  "/api/docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerDocument, { explorer: true })
);

// --------------------------
// Server
// --------------------------

(async () => {
  await ensureAdmin();

  app.listen(3000, () => {
    console.log("API running on http://localhost:3000");
  });
})();
