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
