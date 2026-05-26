const admin = require('firebase-admin');

if (!admin.apps.length) {
  let credential;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    credential = admin.credential.cert(serviceAccount);
  } else {
    credential = admin.credential.applicationDefault();
  }
  admin.initializeApp({
    credential,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

const db = admin.database();
function now() { return Math.floor(Date.now() / 1000); }

async function getNextUserId() {
  const counterRef = db.ref('meta/user_counter');
  const snap = await counterRef.once('value');
  const next = (snap.val() || 0) + 1;
  await counterRef.set(next);
  return next;
}

async function createUser({ username, email, password_hash, display_name, oauth_meta }) {
  const usersRef = db.ref('users');
  const newRef = usersRef.push();
  const uid = await getNextUserId();
  const userData = {
    id: newRef.key,
    uid,
    username: username.toLowerCase(),
    email: (email || '').toLowerCase(),
    password_hash,
    display_name: display_name || username,
    bio: '',
    avatar_color: '#000000',

    avatar_shape: 'circle',
    link_layout: 'list',
    link_btn_style: '{}',
    profile_font: 'Inter',
    bg_type: 'color',
    bg_value: '#fafafa',
    bg_opacity: 1,
    text_color: '#18181b',
    card_bg: '#ffffff',
    card_opacity: 0,
    banner_url: '',
    social_links: '{}',
    spotify_url: '',

    location: '',
    discord_presence: false,
    bg_effect: 'none',
    bg_effect_color: '#ffffff',

    profile_blur: 0,
    username_effect: 'none',
    glow_targets: '',
    accent_color: '#6366f1',
    icon_color: '',
    monochrome_icons: false,
    animated_title: false,
    invert_blocks: false,
    use_discord_avatar: false,
    avatar_decoration: 'none',

    links: [],
    oauth_meta: oauth_meta || '{}',
    created_at: now(),
    updated_at: now(),
  };
  await newRef.set(userData);
  return userData;
}

async function getAllUsers() {
  const snap = await db.ref('users').once('value');
  const val = snap.val();
  if (!val) return [];
  return Object.values(val);
}

async function findUserBy(field, value) {
  const v = typeof value === 'string' ? value.toLowerCase() : value;
  const snap = await db.ref('users').orderByChild(field).equalTo(v).limitToFirst(1).once('value');
  const val = snap.val();
  if (val) return Object.values(val)[0];
  return null;
}

async function findOAuthUser(provider, provider_id) {
  const snap = await db.ref('users')
    .orderByChild('password_hash').equalTo('__oauth__')
    .once('value');
  const val = snap.val();
  if (!val) return null;
  const users = Object.values(val);
  return users.find(u => {
    try {
      const meta = JSON.parse(u.oauth_meta || '{}');
      return String(meta[provider]) === String(provider_id);
    } catch { return false; }
  }) || null;
}

async function findUserById(id) {
  const snap = await db.ref('users').orderByChild('id').equalTo(id).limitToFirst(1).once('value');
  const val = snap.val();
  if (val) return Object.values(val)[0];
  return null;
}

async function updateUser(id, fields) {
  const snap = await db.ref('users').orderByChild('id').equalTo(id).limitToFirst(1).once('value');
  const val = snap.val();
  if (!val) return null;
  const key = Object.keys(val)[0];
  const updated = { ...val[key], ...fields, updated_at: now() };
  await db.ref(`users/${key}`).update({ ...fields, updated_at: now() });
  return updated;
}

async function userExists(username, email) {
  const [byUsername, byEmail] = await Promise.all([
    findUserBy('username', username.toLowerCase()),
    findUserBy('email', email.toLowerCase()),
  ]);
  return !!(byUsername || byEmail);
}

async function recordView(user_id, viewer_ip, referrer) {
  await db.ref('page_views').push({
    user_id,
    viewer_ip: (viewer_ip || '').slice(0, 64),
    referrer: (referrer || '').slice(0, 255),
    created_at: now(),
  });
}

async function recordClick(user_id, link_url, link_title) {
  await db.ref('link_clicks').push({
    user_id,
    link_url: (link_url || '').slice(0, 500),
    link_title: (link_title || '').slice(0, 100),
    created_at: now(),
  });
}

async function getAnalytics(user_id) {
  const ts = now(); const day = 86400;

  const [viewsSnap, clicksSnap] = await Promise.all([
    db.ref('page_views').orderByChild('user_id').equalTo(user_id).once('value'),
    db.ref('link_clicks').orderByChild('user_id').equalTo(user_id).once('value'),
  ]);

  const views  = viewsSnap.val()  ? Object.values(viewsSnap.val())  : [];
  const clicks = clicksSnap.val() ? Object.values(clicksSnap.val()) : [];

  const dailyMap = {};
  views.filter(v => v.created_at >= ts - 30 * day).forEach(v => {
    const d = new Date(v.created_at * 1000).toISOString().slice(0, 10);
    dailyMap[d] = (dailyMap[d] || 0) + 1;
  });
  const daily = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date((ts - i * day) * 1000).toISOString().slice(0, 10);
    daily.push({ day: d, views: dailyMap[d] || 0 });
  }

  const linkMap = {};
  clicks.forEach(c => {
    if (!linkMap[c.link_url]) linkMap[c.link_url] = { link_url: c.link_url, link_title: c.link_title, clicks: 0 };
    linkMap[c.link_url].clicks++;
  });

  return {
    total_views:  views.length,
    total_clicks: clicks.length,
    views_today:  views.filter(v => v.created_at >= ts - day).length,
    views_7d:     views.filter(v => v.created_at >= ts - 7  * day).length,
    views_30d:    views.filter(v => v.created_at >= ts - 30 * day).length,
    clicks_7d:    clicks.filter(c => c.created_at >= ts - 7 * day).length,
    daily,
    top_links: Object.values(linkMap).sort((a, b) => b.clicks - a.clicks).slice(0, 10),
  };
}

async function getProfileTotalViews(user_id) {
  const snap = await db.ref('page_views').orderByChild('user_id').equalTo(user_id).once('value');
  const val = snap.val();
  return val ? Object.keys(val).length : 0;
}

const WEBHOOK_URL = process.env.DISCORD_LOG_WEBHOOK;

async function sendWebhookLog({ type, username, detail, ip }) {
  try {
    const colors = { login: 0x3b82f6, register: 0x16a34a, error: 0xef4444, action: 0xf97316 };
    const emojis = { login: '🔑', register: '✨', error: '❌', action: '⚙️' };
    const labels = { login: 'Connexion', register: 'Inscription', error: 'Erreur', action: 'Action' };

    const embed = {
      color: colors[type] || 0x71717a,
      title: `${emojis[type] || '📋'} ${labels[type] || type}`,
      fields: [
        username ? { name: 'Utilisateur', value: `@${username}`, inline: true } : null,
        detail   ? { name: 'Détail',      value: detail,          inline: true } : null,
        ip       ? { name: 'IP',          value: ip,              inline: true } : null,
      ].filter(Boolean),
      timestamp: new Date().toISOString(),
      footer: { text: 'ak-47.fr logs' },
    };

    const https = require('https');
    const body = JSON.stringify({ embeds: [embed] });
    const url = new URL(WEBHOOK_URL);
    const options = {
      hostname: url.hostname, path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    await new Promise((resolve, reject) => {
      const req = https.request(options, resolve);
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  } catch (err) {
    console.error('Webhook error:', err.message);
  }
}

async function addLog({ type, user_id, username, detail, ip }) {
  await db.ref('logs').push({
    type,
    user_id:  user_id  || null,
    username: username || null,
    detail:   detail   || '',
    ip:       (ip || '').slice(0, 64),
    created_at: now(),
  });
  await sendWebhookLog({ type, username, detail, ip });
}

async function getLogs({ limit = 100, type } = {}) {
  let ref = db.ref('logs').orderByChild('created_at');
  const snap = await ref.limitToLast(limit).once('value');
  const val = snap.val();
  if (!val) return [];
  let logs = Object.values(val).reverse();
  if (type) logs = logs.filter(l => l.type === type);
  return logs;
}

async function getAllUsersAdmin() {
  const snap = await db.ref('users').once('value');
  const val = snap.val();
  if (!val) return [];
  return Object.values(val).map(u => {
    const { password_hash, ...safe } = u;
    return safe;
  });
}


async function getTotalViews() {
  const snap = await db.ref('page_views').once('value');
  const val = snap.val();
  return val ? Object.keys(val).length : 0;
}


async function createTemplate({ user_id, username, name, description, preview_data, config }) {
  const ref = db.ref('templates').push();
  const t = {
    id: ref.key,
    user_id, username, name,
    description: (description || '').slice(0, 200),
    preview_data: preview_data || '',
    config: JSON.stringify(config),
    uses: 0,
    created_at: now(),
  };
  await ref.set(t);
  return t;
}

async function getTemplates({ limit = 50 } = {}) {
  const snap = await db.ref('templates').orderByChild('created_at').limitToLast(limit).once('value');
  const val = snap.val();
  if (!val) return [];
  return Object.values(val).reverse();
}

async function getTemplateById(id) {
  const snap = await db.ref('templates').orderByChild('id').equalTo(id).limitToFirst(1).once('value');
  const val = snap.val();
  if (!val) return null;
  return Object.values(val)[0];
}

async function incrementTemplateUses(id) {
  const snap = await db.ref('templates').orderByChild('id').equalTo(id).limitToFirst(1).once('value');
  const val = snap.val();
  if (!val) return;
  const key = Object.keys(val)[0];
  const cur = val[key].uses || 0;
  await db.ref(`templates/${key}`).update({ uses: cur + 1 });
}

async function deleteTemplate(id) {
  const snap = await db.ref('templates').orderByChild('id').equalTo(id).limitToFirst(1).once('value');
  const val = snap.val();
  if (!val) return false;
  const key = Object.keys(val)[0];
  await db.ref(`templates/${key}`).remove();
  return true;
}

module.exports = {
  createUser, getAllUsers, findUserBy, findOAuthUser, findUserById,
  updateUser, userExists,
  recordView, recordClick, getAnalytics, getProfileTotalViews, getTotalViews,
  addLog, getLogs, getAllUsersAdmin,
  createTemplate, getTemplates, getTemplateById, incrementTemplateUses, deleteTemplate,
};
