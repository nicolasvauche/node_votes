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
    const token = req.headers.authorization?.split(" ")[1];
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
// Routes
// --------------------------

// GET settings
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
  res.json({ success: true });
});

// Register
app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;

  const settings = await query(
    "SELECT value FROM settings WHERE key='registrationsClosed'"
  );
  if (settings[0].value === "true") {
    return res.status(403).json({ error: "Registrations closed" });
  }

  const hashed = await bcrypt.hash(password, 10);

  try {
    await exec(
      "INSERT INTO users (username, password, role, createdAt) VALUES (?, ?, 'user', datetime('now'))",
      [username, hashed]
    );
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "User already exists" });
  }
});

// Login
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  const rows = await query("SELECT * FROM users WHERE username=?", [username]);
  if (rows.length === 0)
    return res.status(400).json({ error: "Invalid credentials" });

  const user = rows[0];
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ error: "Invalid credentials" });

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    "SECRET_KEY_SIMPLE",
    { expiresIn: "2h" }
  );

  res.json({ token });
});

// Vote (user only)
app.post("/api/vote", auth(), async (req, res) => {
  const { value } = req.body; // +1 ou -1

  if (![+1, -1].includes(value)) {
    return res.status(400).json({ error: "Invalid vote value" });
  }

  // 1 vote max / jour
  const todayVotes = await query(
    `SELECT * FROM votes 
     WHERE userId=? AND date(createdAt)=date('now')`,
    [req.user.id]
  );

  if (todayVotes.length > 0) {
    return res.status(403).json({ error: "Already voted today" });
  }

  await exec(
    "INSERT INTO votes (userId, value, createdAt) VALUES (?, ?, datetime('now'))",
    [req.user.id, value]
  );

  res.json({ success: true });
});

// Admin: close all votes (set closedAt)
app.post("/api/admin/close-votes", auth("admin"), async (req, res) => {
  await exec(
    "UPDATE votes SET closedAt=datetime('now') WHERE closedAt IS NULL"
  );
  res.json({ success: true });
});

// Admin: reset votes (delete all)
app.post("/api/admin/reset-votes", auth("admin"), async (req, res) => {
  await exec("DELETE FROM votes");
  res.json({ success: true });
});

// Get vote stats
app.get("/api/votes", async (req, res) => {
  const rows = await query("SELECT * FROM votes");
  res.json(rows);
});

app.listen(3000, () => console.log("API running on http://localhost:3000"));
