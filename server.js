require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', methods: ['GET','POST','PATCH','DELETE'], allowedHeaders: ['Content-Type','Authorization'] }));

const verifyCaptcha = async (req, res, next) => {
  if (req.method !== 'POST') return next();
  const token = req.body['h-captcha-response'] || req.headers['x-captcha-token'];
  if (!token) return res.status(400).json({ error: 'Captcha requis' });

  try {
    const params = new URLSearchParams({
      secret: process.env.HCAPTCHA_SECRET,
      response: token,
    });
    const r = await fetch('https://hcaptcha.com/siteverify', { method: 'POST', body: params });
    const data = await r.json();
    if (!data.success) return res.status(400).json({ error: 'Captcha invalide' });
    next();
  } catch (err) {
    console.error('hCaptcha error:', err);
    return res.status(500).json({ error: 'Erreur vérification captcha' });
  }
};

app.use(express.json({ limit: '75mb' }));
app.use(express.urlencoded({ extended: false }));

app.use('/api/auth/discord', require('./routes/oauth_discord'));
app.use('/api/auth/google',  require('./routes/oauth_google'));
app.use('/api/auth',        verifyCaptcha, require('./routes/auth'));
app.use('/api/user',                       require('./routes/user'));
app.use('/api/analytics',                  require('./routes/analytics'));
app.use('/api/profile',                    require('./routes/profile'));
app.use('/api/leaderboard',                require('./routes/leaderboard'));
app.use('/api/stats',                      require('./routes/stats'));
app.use('/api/admin',                      require('./routes/admin'));
app.use('/api/templates',                  require('./routes/templates'));
app.get('/api/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

const { authMiddleware } = require('./middleware/auth');
const db = require('./models/db');
app.post('/api/heartbeat', authMiddleware, async (req, res) => {
  try {
    await db.updateUser(req.user.id, { last_seen: Math.floor(Date.now() / 1000) });
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erreur' }); }
});


const _hpDb = require('./models/db');

app.get('/api/backup/db.json', async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const ua = (req.headers['user-agent'] || 'inconnu').slice(0, 200);
  try {
    await _hpDb.addLog({ type: 'error', username: 'INTRUSION', detail: `Tentative d'accès non autorisé — IP: ${ip} — UA: ${ua}`, ip });
  } catch {}
  await new Promise(r => setTimeout(r, 3500));
  const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
  res.redirect(`${BASE_URL}/security-alert?ip=${encodeURIComponent(ip)}`);
});

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Erreur interne' }); });

app.listen(PORT, () => {
  console.log(`\n  ✓ ak-47.fr → http://localhost:${PORT}\n`);

  const SELF_URL = (process.env.BACKEND_URL || `http://localhost:${PORT}`) + '/api/health';
  setInterval(async () => {
    try {
      await fetch(SELF_URL);
    } catch (e) {
      console.error('Self-ping failed:', e.message);
    }
  }, 10 * 60 * 1000);
});
module.exports = app;
