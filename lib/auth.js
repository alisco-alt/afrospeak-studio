'use strict';
/**
 * AUTHENTIFICATION — JWT signés (jose) + bcrypt, adossés à Neon.
 *
 * Choix d'un JWT maison plutôt que NextAuth : le backend est un Express
 * autonome servi par le même conteneur, et un cookie httpOnly signé suffit.
 * Aucune dépendance à un fournisseur externe, donc rien à payer.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { SignJWT, jwtVerify } = require('jose');
const db = require('./db');
const { logger, DIRS, readJSON, writeJSON } = require('./util');
const path = require('path');

const log = logger('auth');
const COOKIE = 'afrospeak_session';
const TTL_DAYS = 30;

/* Secret : variable d'env en production, sinon généré et persisté. */
let SECRET = null;
function secret() {
  if (SECRET) return SECRET;
  let s = process.env.AUTH_SECRET || process.env.JWT_SECRET;
  if (!s) {
    const f = path.join(DIRS.data, 'auth-secret.json');
    const saved = readJSON(f, null);
    if (saved && saved.secret) s = saved.secret;
    else {
      s = crypto.randomBytes(48).toString('base64url');
      try { writeJSON(f, { secret: s }); } catch (e) {}
      log.warn('AUTH_SECRET non défini — secret généré (définissez-le en production)');
    }
  }
  SECRET = new TextEncoder().encode(s);
  return SECRET;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

function validate(email, password) {
  if (!email || !EMAIL_RE.test(String(email))) throw badRequest('Adresse e-mail invalide.');
  if (!password || String(password).length < 8) throw badRequest('Le mot de passe doit faire au moins 8 caractères.');
}
function badRequest(msg) { const e = new Error(msg); e.status = 400; return e; }
function unauthorized(msg = 'Non authentifié.') { const e = new Error(msg); e.status = 401; return e; }

async function signToken(user) {
  return new SignJWT({ uid: user.id, email: user.email, role: user.role || 'user' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('afrospeak-studio')
    .setExpirationTime(`${TTL_DAYS}d`)
    .sign(secret());
}

async function verifyToken(token) {
  const { payload } = await jwtVerify(token, secret(), { issuer: 'afrospeak-studio' });
  return payload;
}

async function register({ email, password, name }) {
  validate(email, password);
  const existing = await db.findUserByEmail(email);
  if (existing) throw badRequest('Un compte existe déjà avec cette adresse.');
  const hash = await bcrypt.hash(String(password), 10);
  // Le tout premier compte devient administrateur.
  const n = await db.countUsers();
  const role = n === 0 ? 'admin' : 'user';
  const quota = role === 'admin' ? 999 : Number(process.env.FREE_DAILY_QUOTA || 5);
  const user = await db.createUser({ email, passwordHash: hash, name, role, quota });
  await db.logUsage(user.id, 'register', { role });
  log.info(`compte créé : ${user.email} (${role})`);
  return user;
}

async function login({ email, password }) {
  if (!email || !password) throw badRequest('E-mail et mot de passe requis.');
  const user = await db.findUserByEmail(email);
  if (!user) throw unauthorized('Identifiants incorrects.');
  const ok = await bcrypt.compare(String(password), user.password_hash);
  if (!ok) throw unauthorized('Identifiants incorrects.');
  await db.touchLogin(user.id);
  await db.logUsage(user.id, 'login');
  return user;
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, name: u.name, role: u.role,
    plan: u.plan, quotaDaily: u.quota_daily,
    createdAt: u.created_at, lastLoginAt: u.last_login_at,
  };
}

function cookieOptions() {
  const secure = process.env.NODE_ENV === 'production' && process.env.COOKIE_INSECURE !== '1';
  // Frontend sur un domaine distinct (Vercel) -> SameSite=None obligatoire,
  // et SameSite=None impose Secure.
  const crossSite = !!process.env.ALLOWED_ORIGINS;
  return {
    httpOnly: true,
    secure: secure || crossSite,
    sameSite: crossSite ? 'none' : 'lax',
    maxAge: TTL_DAYS * 86400 * 1000,
    path: '/',
  };
}

/** Lit le jeton depuis le cookie ou l'en-tête Authorization. */
function readToken(req) {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/** Middleware : attache req.user si un jeton valide est présent. */
async function attach(req, res, next) {
  try {
    const token = readToken(req);
    if (token) {
      const payload = await verifyToken(token);
      const user = await db.findUserById(payload.uid);
      if (user) req.user = user;
    }
  } catch (e) { /* jeton invalide → visiteur anonyme */ }
  next();
}

/** Middleware : exige une session. */
function required(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, error: 'Connexion requise.', code: 'AUTH' });
  next();
}

/** Middleware : exige le rôle admin. */
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Réservé à l’administrateur.', code: 'FORBIDDEN' });
  }
  next();
}

/**
 * Mode mono-utilisateur : si SINGLE_USER=1, toutes les requêtes sont
 * authentifiées comme le compte propriétaire. Pratique pour un déploiement
 * personnel sans écran de connexion.
 */
function singleUserEnabled() { return process.env.SINGLE_USER === '1'; }

async function ensureSingleUser() {
  // Accès libre par défaut ; désactivé seulement si REQUIRE_AUTH=1
  if (process.env.REQUIRE_AUTH === '1') return null;
  const email = process.env.OWNER_EMAIL || 'owner@afrospeak.local';
  let u = await db.findUserByEmail(email);
  if (!u) {
    const pass = process.env.OWNER_PASSWORD || crypto.randomBytes(12).toString('base64url');
    // en accès libre le propriétaire n'est pas bridé
    await register({ email, password: pass, name: 'Propriétaire' });
    u = await db.findUserByEmail(email);
    log.info(`mode mono-utilisateur : compte ${email} créé`);
  }
  return u;
}

module.exports = {
  register, login, publicUser, signToken, verifyToken,
  attach, required, adminOnly, cookieOptions, readToken,
  COOKIE, singleUserEnabled, ensureSingleUser, badRequest, unauthorized,
};
