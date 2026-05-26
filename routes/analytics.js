const express = require('express');
const db = require('../models/db');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  res.json(await db.getAnalytics(req.user.id));
});

router.get('/profile/:username', async (req, res) => {
  const user = await db.findUserBy('username', req.params.username);
  if (!user) return res.status(404).json({ error: 'Introuvable' });
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0];
  await db.recordView(user.id, ip, req.headers.referer || '');
  res.json({ ok: true });
});

router.post('/click', async (req, res) => {
  const { username, link_url, link_title } = req.body;
  if (!username || !link_url) return res.status(400).json({ error: 'Paramètres manquants' });
  const user = await db.findUserBy('username', username);
  if (!user) return res.status(404).json({ error: 'Introuvable' });
  await db.recordClick(user.id, link_url, link_title);
  res.json({ ok: true });
});

module.exports = router;
