const { JWT_SECRET } = require('./auth');
const jwt = require('jsonwebtoken');
const db = require('../models/db');

const ADMIN_DISCORD_IDS = ['866613427852804136'];

async function adminMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Token manquant' });
  const token = auth.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.findUserById(decoded.id);
    if (!user) return res.status(401).json({ error: 'Utilisateur introuvable' });
    if (!ADMIN_DISCORD_IDS.includes(user.discord_id)) return res.status(403).json({ error: 'Accès refusé' });
    req.user = decoded;
    req.adminUser = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide' });
  }
}

module.exports = { adminMiddleware, ADMIN_DISCORD_IDS };
