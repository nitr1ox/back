const express = require('express');
const db = require('../models/db');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const users = await db.getAllUsers();

    const withViews = await Promise.all(
      users.map(async u => ({
        username: u.username,
        display_name: u.display_name,
        avatar_color: u.avatar_color,
        total_views: await db.getProfileTotalViews(u.id),
      }))
    );
    const sorted = withViews
      .sort((a, b) => b.total_views - a.total_views)
      .slice(0, 20);
    res.json(sorted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur' });
  }
});

module.exports = router;
