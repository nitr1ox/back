const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const db = require('../models/db');
const { processDiscordLogin, getDiscordBadges } = require('../bot');
const { JWT_SECRET, authMiddleware } = require('../middleware/auth');
const { checkRateLimit, findOrCreateOAuthUser, redirectWithToken, redirectWithError, generateState, validateState, BACKEND_URL } = require('./oauth_shared');

const router = express.Router();
const DISCORD_CLIENT_ID     = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;

const linkTokens = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of linkTokens) if (now > v.expires) linkTokens.delete(k);
}, 60_000);

router.get('/', (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0];
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Trop de tentatives' });
  if (!DISCORD_CLIENT_ID) return res.status(500).json({ error: 'Discord OAuth non configuré' });
  const state = generateState();

  if (req.query.link === '1' && req.query.jwt) {
    try {
      const payload = jwt.verify(req.query.jwt, JWT_SECRET);
      linkTokens.set(state, { userId: payload.id, expires: Date.now() + 10 * 60_000 });
    } catch {  }
  }

  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: `${BACKEND_URL}/api/auth/discord/callback`,
    response_type: 'code', scope: 'identify email guilds guilds.join', state,
  });
  res.redirect('https://discord.com/api/oauth2/authorize?' + params);
});

router.get('/callback', async (req, res) => {
  const { code, error, state } = req.query;
  if (!validateState(state)) return redirectWithError(res, 'Session OAuth expirée, réessaie');
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
    const { badges } = await processDiscordLogin(discordUser, tokenRes.data.access_token);
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0];

    const linkEntry = linkTokens.get(state);
    if (linkEntry) {
      linkTokens.delete(state);
      const existingUser = await db.findUserById(linkEntry.userId);
      if (!existingUser) return redirectWithError(res, 'Utilisateur introuvable');
      await db.updateUser(existingUser.id, {
        discord_id: id,
        discord_username: global_name || username,
        discord_badges: JSON.stringify(badges),
        discord_access_token: tokenRes.data.access_token,
      });
      await db.addLog({ type: 'link', user_id: existingUser.id, username: existingUser.username, detail: 'Compte Discord lié', ip });
      const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
      return res.redirect(`${BASE_URL}/dashboard?linked=discord`);
    }

    const { user, isNew } = await findOrCreateOAuthUser({ provider: 'discord', provider_id: id, email, display_name: global_name || username });
    await db.updateUser(user.id, {
      discord_id: id,
      discord_username: global_name || username,
      discord_badges: JSON.stringify(badges),
      discord_access_token: tokenRes.data.access_token,
    });
    user.discord_id = id;
    await db.addLog({ type: isNew ? 'register' : 'login', user_id: user.id, username: user.username, detail: isNew ? 'Inscription via Discord' : 'Connexion via Discord', ip });
    redirectWithToken(res, user, isNew);
  } catch (err) {
    console.error('Discord OAuth error:', err.response?.data || err.message);
    redirectWithError(res, 'Erreur lors de la connexion Discord');
  }
});
router.post('/refresh-badges', authMiddleware, async (req, res) => {
  try {
    const user = await db.findUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    if (!user.discord_id) return res.status(400).json({ error: 'Aucun compte Discord lié' });

    const accessToken = user.discord_access_token;
    if (!accessToken) return res.status(400).json({ error: 'Token Discord expiré, reconnecte ton compte Discord' });
    let discordUser = null;
    try {
      const userRes = await axios.get('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      discordUser = userRes.data;
    } catch {
      discordUser = { id: user.discord_id, public_flags: 0 };
    }

    const { badges } = await processDiscordLogin(discordUser, accessToken);
    await db.updateUser(user.id, { discord_badges: JSON.stringify(badges) });

    res.json({ ok: true, badges });
  } catch (err) {
    console.error('refresh-badges error:', err.message);
    res.status(500).json({ error: 'Erreur lors du rafraîchissement des badges' });
  }
});

module.exports = router;
