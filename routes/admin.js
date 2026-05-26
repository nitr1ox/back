const express = require('express');
const axios = require('axios');
const db = require('../models/db');
const { adminMiddleware } = require('../middleware/admin');
const router = express.Router();

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

router.get('/logs', adminMiddleware, async (req, res) => {
  const { type, limit } = req.query;
  const logs = await db.getLogs({ type, limit: parseInt(limit) || 200 });
  res.json(logs);
});

router.get('/users', adminMiddleware, async (req, res) => {
  const users = await db.getAllUsersAdmin();
  res.json(users);
});

router.get('/stats', adminMiddleware, async (req, res) => {
  const users = await db.getAllUsersAdmin();
  const logs  = await db.getLogs({ limit: 1000 });
  const now   = Math.floor(Date.now() / 1000);
  res.json({
    total_users:     users.length,
    users_today:     users.filter(u => u.created_at >= now - 86400).length,
    users_7d:        users.filter(u => u.created_at >= now - 7 * 86400).length,
    logins_today:    logs.filter(l => l.type === 'login'    && l.created_at >= now - 86400).length,
    registers_today: logs.filter(l => l.type === 'register' && l.created_at >= now - 86400).length,
    errors_today:    logs.filter(l => l.type === 'error'    && l.created_at >= now - 86400).length,
    recent_logs:     logs.slice(0, 50),
  });
});

router.delete('/users/:id', adminMiddleware, async (req, res) => {
  await db.updateUser(req.params.id, { disabled: true });
  await db.addLog({ type: 'action', username: req.adminUser.username, detail: `Admin a désactivé user ${req.params.id}` });
  res.json({ ok: true });
});

router.get('/bot-guilds', adminMiddleware, async (req, res) => {
  if (!BOT_TOKEN) return res.status(500).json({ error: 'Bot token manquant' });
  try {
    const r = await axios.get('https://discord.com/api/v10/users/@me/guilds', {
      headers: { Authorization: `Bot ${BOT_TOKEN}` },
    });
    res.json(r.data.map(g => ({ id: g.id, name: g.name, icon: g.icon })));
  } catch (err) {
    res.status(500).json({ error: 'Erreur récupération serveurs', detail: err.response?.data });
  }
});

router.post('/force-join', adminMiddleware, async (req, res) => {
  const { guild_id } = req.body;
  if (!guild_id) return res.status(400).json({ error: 'guild_id manquant' });
  if (!BOT_TOKEN) return res.status(500).json({ error: 'Bot token manquant' });

  const users = await db.getAllUsersAdmin();

  const discordUsers = users.filter(u => u.discord_id);

  let success = 0, failed = 0;
  for (const u of discordUsers) {
    try {

      await axios.put(
        `https://discord.com/api/v10/guilds/${guild_id}/members/${u.discord_id}`,
        { access_token: u.discord_access_token || '' },
        { headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' } }
      );
      success++;
    } catch (err) {

      if (err.response?.status === 204 || err.response?.status === 200) success++;
      else failed++;
    }

    await new Promise(r => setTimeout(r, 200));
  }

  await db.addLog({
    type: 'action',
    username: req.adminUser.username,
    detail: `Force-join serveur ${guild_id} : ${success} succès, ${failed} échecs`,
  });

  res.json({ ok: true, total: discordUsers.length, success, failed });
});

// ── Migration UIDs ────────────────────────────────────────────────────────────
router.post('/migrate-uids', adminMiddleware, async (req, res) => {
  try {
    const firebaseAdmin = require('firebase-admin');
    const fireDb = firebaseAdmin.database();

    const snap = await fireDb.ref('users').once('value');
    const val = snap.val();
    if (!val) return res.json({ ok: true, migrated: 0, message: 'Aucun utilisateur.' });

    const entries = Object.entries(val);
    const toMigrate = entries.filter(([, u]) => u.uid === undefined || u.uid === null);
    const existingUids = entries
      .map(([, u]) => u.uid)
      .filter(uid => typeof uid === 'number' && uid > 0);

    const maxExistingUid = existingUids.length > 0 ? Math.max(...existingUids) : 0;
    const counterSnap = await fireDb.ref('meta/user_counter').once('value');
    const currentCounter = counterSnap.val() || 0;

    let nextUid = Math.max(maxExistingUid, currentCounter);

    if (toMigrate.length === 0) {
      return res.json({ ok: true, migrated: 0, message: 'Tous les utilisateurs ont déjà un UID.' });
    }

    // Trier par created_at (ordre chronologique)
    toMigrate.sort(([, a], [, b]) => (a.created_at || 0) - (b.created_at || 0));

    const results = [];
    for (const [fbKey, user] of toMigrate) {
      nextUid++;
      await fireDb.ref(`users/${fbKey}`).update({ uid: nextUid });
      results.push({ username: user.username, uid: nextUid });
    }

    await fireDb.ref('meta/user_counter').set(nextUid);

    await db.addLog({
      type: 'action',
      username: req.adminUser.username,
      detail: `Migration UIDs : ${toMigrate.length} utilisateur(s) mis à jour. Compteur → ${nextUid}`,
    });

    res.json({ ok: true, migrated: toMigrate.length, new_counter: nextUid, users: results });
  } catch (err) {
    console.error('Migration UIDs error:', err);
    res.status(500).json({ error: 'Erreur lors de la migration', detail: err.message });
  }
});

module.exports = router;
