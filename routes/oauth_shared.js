
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../models/db');
const { JWT_SECRET } = require('../middleware/auth');

const BASE_URL    = process.env.BASE_URL    || 'http://localhost:3000';
const BACKEND_URL = process.env.BACKEND_URL || BASE_URL;

const oauthRateLimit = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = oauthRateLimit.get(ip) || { count: 0, reset: now + 60_000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 60_000; }
  entry.count++;
  oauthRateLimit.set(ip, entry);
  return entry.count <= 10;
}
setInterval(() => { const now = Date.now(); for (const [ip, e] of oauthRateLimit) if (now > e.reset) oauthRateLimit.delete(ip); }, 300_000);

function makeToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

function toUsername(raw) {
  const cleaned = (raw || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 28);
  return cleaned.length >= 2 ? cleaned : 'user';
}

async function findOrCreateOAuthUser({ provider, provider_id, email, display_name }) {
  let user = email ? await db.findUserBy('email', email) : null;
  if (!user) user = await db.findOAuthUser(provider, String(provider_id));
  if (user) return { user, isNew: false };

  const RESERVED = ['admin','api','login','register','dashboard','settings','leaderboard','status','recovery','help','terms','privacy','support','www','setup'];
  let username = toUsername(display_name || email?.split('@')[0] || provider);
  let base = username, n = 1;
  while (await db.findUserBy('username', username) || RESERVED.includes(username)) username = base + n++;

  const safeEmail = email || `oauth_${crypto.randomBytes(8).toString('hex')}@noreply.ak47fr`;
  const newUser = await db.createUser({
    username, email: safeEmail, password_hash: '__oauth__',
    display_name: display_name || username,
    oauth_meta: JSON.stringify({ [provider]: provider_id }),
  });
  return { user: newUser, isNew: true };
}

function redirectWithToken(res, user, isNew = false) {
  const token = makeToken(user);
  res.redirect(`${BASE_URL}/oauth-callback.html?token=${encodeURIComponent(token)}${isNew ? '&new=1' : ''}`);
}
function redirectWithError(res, msg) {
  res.redirect(`${BASE_URL}/login?error=${encodeURIComponent(msg)}`);
}

function generateState() {
  const rand = crypto.randomBytes(16).toString('hex');
  const ts = Date.now().toString(36);
  const raw = rand + '.' + ts;
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(raw).digest('hex').slice(0, 16);
  return raw + '.' + sig;
}
function validateState(state) {
  if (!state) return false;
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [rand, ts, sig] = parts;
  const raw = rand + '.' + ts;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(raw).digest('hex').slice(0, 16);
  if (sig !== expected) return false;
  return Date.now() - parseInt(ts, 36) <= 15 * 60 * 1000;
}

module.exports = { checkRateLimit, findOrCreateOAuthUser, redirectWithToken, redirectWithError, generateState, validateState, BACKEND_URL };
