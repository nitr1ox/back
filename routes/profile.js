const express = require('express');
const db = require('../models/db');
const router = express.Router();

router.get('/:username', async (req, res) => {
  const user = await db.findUserBy('username', req.params.username);
  if (!user) return res.status(404).json({ error: 'Profil introuvable' });
  const { password_hash, email, discord_access_token, oauth_meta, ...pub } = user;
  if (!pub.last_seen) pub.last_seen = pub.updated_at || pub.created_at || 0;
  pub.total_views = await db.getProfileTotalViews(user.id);
  res.json(pub);
});

module.exports = router;
