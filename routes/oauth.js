const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../models/db');
const { JWT_SECRET } = require('../middleware/auth');
const { processDiscordLogin } = require('../bot');

const router = express.Router();

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const DISCORD_CLIENT_ID    = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;

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

setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of oauthRateLimit) if (now > e.reset) oauthRateLimit.delete(ip);
}, 300_000);

function makeToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

function toUsername(raw) {
  const cleaned = (raw || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 28);
  return cleaned.length >= 2 ? cleaned : 'user';
}

async function findOrCreateOAuthUser({ provider, provider_id, email, display_name }) {

  let user = email ? await db.findUserBy('email', email) : null;

  if (!user) {
    user = await db.findOAuthUser(provider, String(provider_id));
  }

  if (user) {
    return { user, isNew: false };
  }

  const RESERVED = ['admin','api','login','register','dashboard','settings','leaderboard','status','recovery','help','terms','privacy','support','www','setup'];
  let username = toUsername(display_name || email?.split('@')[0] || provider);
  let base = username, n = 1;
  while (await db.findUserBy('username', username) || RESERVED.includes(username)) {
    username = base + n++;
  }

  const safeEmail = email || `oauth_${crypto.randomBytes(8).toString('hex')}@noreply.ak47fr`;

  const newUser = await db.createUser({
    username,
    email: safeEmail,
    password_hash: '__oauth__',
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

  const age = Date.now() - parseInt(ts, 36);
  if (age > 15 * 60 * 1000) return false;
  return true;
}

router.get('/', (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0];
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Trop de tentatives, réessaie dans une minute' });
  if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google OAuth non configuré' });
  const state = generateState();
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${BACKEND_URL}/api/auth/google/callback`,
    response_type: 'code', scope: 'openid email profile',
    access_type: 'offline', prompt: 'select_account',
    state,
  });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params);
});

router.get('/callback', async (req, res) => {
  const { code, error, state } = req.query;
  if (!validateState(state)) return redirectWithError(res, 'Session OAuth expirée ou invalide, réessaie');
  if (error || !code) return redirectWithError(res, 'Connexion Google annulée');
  try {
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: `${BACKEND_URL}/api/auth/google/callback`, grant_type: 'authorization_code',
    });
    const userRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` },
    });
    const { id, email, name } = userRes.data;
    const { user, isNew } = await findOrCreateOAuthUser({ provider: 'google', provider_id: id, email, display_name: name });
    redirectWithToken(res, user, isNew);
  } catch (err) {
    console.error('Google OAuth error:', err.response?.data || err.message);
    redirectWithError(res, 'Erreur lors de la connexion Google');
  }
});

router.get('/', (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0];
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Trop de tentatives, réessaie dans une minute' });
  if (!DISCORD_CLIENT_ID) return res.status(500).json({ error: 'Discord OAuth non configuré' });
  const state = generateState();
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID, redirect_uri: `${BACKEND_URL}/api/auth/discord/callback`,
    response_type: 'code', scope: 'identify email guilds.join',
    state,
  });
  res.redirect('https://discord.com/api/oauth2/authorize?' + params);
});

router.get('/callback', async (req, res) => {
  const { code, error, state } = req.query;
  if (!validateState(state)) return redirectWithError(res, 'Session OAuth expirée ou invalide, réessaie');
  if (error || !code) return redirectWithError(res, 'Connexion Discord annulée');
  try {
    const tokenRes = await axios.post('https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code', code,
        redirect_uri: `${BACKEND_URL}/api/auth/discord/callback`,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` },
    });
    const discordUser = userRes.data;
    const { id, email, username, global_name } = discordUser;
    const accessToken = tokenRes.data.access_token;

    const { user, isNew } = await findOrCreateOAuthUser({ provider: 'discord', provider_id: id, email, display_name: global_name || username });

    const { badges } = await processDiscordLogin(discordUser, accessToken);

    await db.updateUser(user.id, {
      discord_id: id,
      discord_badges: JSON.stringify(badges),
    });
    user.discord_id = id;

    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0];
    await db.addLog({
      type: isNew ? 'register' : 'login',
      user_id: user.id,
      username: user.username,
      detail: isNew ? 'Inscription via Discord' : 'Connexion via Discord',
      ip,
    });

    redirectWithToken(res, user, isNew);
  } catch (err) {
    console.error('Discord OAuth error:', err.response?.data || err.message);
    redirectWithError(res, 'Erreur lors de la connexion Discord');
  }
});

module.exports = router;
