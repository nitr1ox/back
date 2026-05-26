const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../models/db');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();
const RESERVED = ['admin','api','login','register','dashboard','settings','leaderboard','status','recovery','help','terms','privacy','support','www'];

router.post('/register', [
  body('username').trim().isLength({min:2,max:30}).withMessage('Pseudo : 2–30 caractères').matches(/^[a-zA-Z0-9_-]+$/).withMessage('Pseudo invalide'),
  body('email').isEmail().withMessage('Email invalide').normalizeEmail(),
  body('password').isLength({min:8}).withMessage('Mot de passe : 8 caractères minimum'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  const { username, email, password } = req.body;
  if (RESERVED.includes(username.toLowerCase())) return res.status(400).json({ error: 'Ce pseudo est réservé' });
  if (await db.userExists(username, email)) return res.status(409).json({ error: 'Pseudo ou email déjà utilisé' });
  const password_hash = bcrypt.hashSync(password, 10);
  const user = await db.createUser({ username, email, password_hash });
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  await db.addLog({ type: 'register', user_id: user.id, username: user.username, detail: 'Inscription par email', ip });
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.status(201).json({ token, username: user.username });
});

router.post('/login', [
  body('login').trim().notEmpty().withMessage('Identifiant requis'),
  body('password').notEmpty().withMessage('Mot de passe requis'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  const { login, password } = req.body;
  const user = await db.findUserBy('username', login) || await db.findUserBy('email', login);
  if (!user) return res.status(401).json({ error: 'Identifiants incorrects' });
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Identifiants incorrects' });
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, username: user.username });
});

module.exports = router;
