const express = require('express');
const db = require('../models/db');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const users = await db.getAllUsers();
    res.json({
      total_users: users.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur' });
  }
});

module.exports = router;
