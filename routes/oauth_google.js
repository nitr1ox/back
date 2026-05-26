const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const db = require('../models/db');
const { JWT_SECRET } = require('../middleware/auth');
const { checkRateLimit, findOrCreateOAuthUser, redirectWithToken, redirectWithError, generateState, validateState, BACKEND_URL } = require('./oauth_shared');

const router = express.Router();
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const linkTokens = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of linkTokens) if (now > v.expires) linkTokens.delete(k);
}, 60_000);

router.get('/', (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0];
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Trop de tentatives' });
  if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google OAuth non configuré' });
  const state = generateState();

  if (req.query.link === '1' && req.query.jwt) {
    try {
      const payload = jwt.verify(req.query.jwt, JWT_SECRET);
      linkTokens.set(state, { userId: payload.id, expires: Date.now() + 10 * 60_000 });
    } catch {  }
  }

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${BACKEND_URL}/api/auth/google/callback`,
    response_type: 'code', scope: 'openid email profile',
    access_type: 'offline', prompt: 'select_account', state,
  });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params);
});

router.get('/callback', async (req, res) => {
  const { code, error, state } = req.query;
  if (!validateState(state)) return redirectWithError(res, 'Session OAuth expirée, réessaie');
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
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0];

    const linkEntry = linkTokens.get(state);
    if (linkEntry) {
      linkTokens.delete(state);
      const existingUser = await db.getUser(linkEntry.userId);
      if (!existingUser) return redirectWithError(res, 'Utilisateur introuvable');
      await db.updateUser(existingUser.id, { google_id: id });
      await db.addLog({ type: 'link', user_id: existingUser.id, username: existingUser.username, detail: 'Compte Google lié', ip });
      const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
      return res.redirect(`${BASE_URL}/dashboard?linked=google`);
    }

    const { user, isNew } = await findOrCreateOAuthUser({ provider: 'google', provider_id: id, email, display_name: name });
    await db.addLog({ type: isNew ? 'register' : 'login', user_id: user.id, username: user.username, detail: isNew ? 'Inscription via Google' : 'Connexion via Google', ip });
    redirectWithToken(res, user, isNew);
  } catch (err) {
    console.error('Google OAuth error:', err.response?.data || err.message);
    redirectWithError(res, 'Erreur lors de la connexion Google');
  }
});

module.exports = router;
