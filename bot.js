const axios = require('axios');
const { Client, GatewayIntentBits, ActivityType, REST, Routes, EmbedBuilder, Partials } = require('discord.js');
const db = require('./models/db');

const BOT_TOKEN        = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID         = process.env.DISCORD_GUILD_ID         || '1484873435224997898';
const ROLE_MEMBRE      = process.env.DISCORD_ROLE_MEMBRE      || '1508369964300763318';
const ROLE_STAFF       = process.env.DISCORD_ROLE_STAFF       || '1508369460891877417';
const ROLE_VIP         = process.env.DISCORD_ROLE_VIP         || '1508369649429909634';
const ROLE_OWNER       = process.env.DISCORD_ROLE_OWNER       || '1504451083756634286';
const OWNER_DISCORD_ID = process.env.OWNER_DISCORD_ID         || '866613427852804136';

const PREFIX = '-';

const api = axios.create({
  baseURL: 'https://discord.com/api/v10',
  headers: { Authorization: `Bot ${BOT_TOKEN}` },
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel],
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function isOwner(userId) { return userId === OWNER_DISCORD_ID; }
function fmt(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n); }
function tsToDate(ts) {
  return ts ? new Date(ts * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}

// ─── Carousel statut ────────────────────────────────────────────────────────

let _carouselStatuses = [];
let _carouselInterval = null;

async function refreshCarouselData() {
  try {
    const [users, totalViews] = await Promise.all([db.getAllUsers(), db.getTotalViews()]);
    _carouselStatuses = [
      { name: 'ak-47.fr',                    type: ActivityType.Watching },
      { name: `${users.length} membres`,     type: ActivityType.Watching },
      { name: `${totalViews} vues totales`,  type: ActivityType.Watching },
    ];
  } catch (e) { console.error('Carousel error:', e.message); }
}

function startCarousel() {
  if (_carouselInterval) clearInterval(_carouselInterval);
  let i = 0;
  const tick = () => {
    if (!client.user || !_carouselStatuses.length) return;
    client.user.setActivity(_carouselStatuses[i % _carouselStatuses.length]);
    i++;
  };
  tick();
  _carouselInterval = setInterval(tick, 10_000);
}

// ─── Commandes préfixées ─────────────────────────────────────────────────────

const COMMANDS = {

  // ── Aide ──────────────────────────────────────────────────────────────────
  help: {
    desc: 'Liste des commandes disponibles',
    ownerOnly: false,
    async run(msg) {
      const publicCmds  = Object.entries(COMMANDS).filter(([, v]) => !v.ownerOnly);
      const adminCmds   = Object.entries(COMMANDS).filter(([, v]) =>  v.ownerOnly);
      const line = (name, v) => `\`${PREFIX}${name}\` — ${v.desc}`;

      const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('📖 Commandes ak-47.fr')
        .addFields(
          { name: '🌐 Publiques',            value: publicCmds.map(([n, v]) => line(n, v)).join('\n') },
          { name: '🔒 Admin (owner only)',   value: adminCmds.map(([n, v]) => line(n, v)).join('\n') },
        )
        .setFooter({ text: 'ak-47.fr' });
      msg.reply({ embeds: [embed] });
    },
  },

  // ── Profil d'un membre ────────────────────────────────────────────────────
  user: {
    desc: '-user <pseudo / @mention / discord_id>',
    ownerOnly: false,
    async run(msg, args) {
      const cible = args[0]?.replace(/^<@!?/, '').replace(/>$/, '');
      if (!cible) return msg.reply('Usage : `-user <pseudo>`');

      const user = await db.findUserBy('username', cible)
                || await db.findUserBy('discord_id', cible)
                || await db.findUserById(cible);

      if (!user) return msg.reply(`❌ Aucun membre trouvé pour \`${cible}\``);

      const views = await db.getProfileTotalViews(user.id);
      let badges = []; try { badges = JSON.parse(user.discord_badges || '[]'); } catch {}
      const badgeStr = badges.length ? badges.map(b => b.emoji + ' ' + b.label).join(', ') : 'Aucun';

      const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('👤 ' + (user.display_name || user.username))
        .setThumbnail(user.avatar_url || null)
        .addFields(
          { name: 'Pseudo',          value: '@' + user.username,                                    inline: true },
          { name: 'UID',             value: user.uid ? '#' + user.uid : '—',                        inline: true },
          { name: 'Vues profil',     value: fmt(views),                                             inline: true },
          { name: 'Inscrit le',      value: tsToDate(user.created_at),                              inline: true },
          { name: 'Dernière visite', value: tsToDate(user.last_seen || user.updated_at),            inline: true },
          { name: 'Discord',         value: user.discord_username ? '@' + user.discord_username : '—', inline: true },
          { name: 'Badges',          value: badgeStr,                                               inline: false },
          { name: 'Lien',            value: 'https://ak-47.fr/' + user.username,                   inline: false },
        )
        .setFooter({ text: 'ak-47.fr' })
        .setTimestamp();

      msg.reply({ embeds: [embed] });
    },
  },

  // ── Stats globales ────────────────────────────────────────────────────────
  stats: {
    desc: 'Statistiques globales du site',
    ownerOnly: false,
    async run(msg) {
      const [users, totalViews] = await Promise.all([db.getAllUsers(), db.getTotalViews()]);
      const now   = Math.floor(Date.now() / 1000);
      const today = users.filter(u => u.created_at >= now - 86400).length;

      const embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('📊 Statistiques ak-47.fr')
        .addFields(
          { name: 'Membres totaux',        value: fmt(users.length), inline: true },
          { name: 'Vues totales',          value: fmt(totalViews),   inline: true },
          { name: "Inscrits aujourd'hui",  value: String(today),     inline: true },
        )
        .setTimestamp();

      msg.reply({ embeds: [embed] });
    },
  },

  // ── Lien profil rapide ────────────────────────────────────────────────────
  profil: {
    desc: '-profil <pseudo> → lien direct vers le profil',
    ownerOnly: false,
    async run(msg, args) {
      const pseudo = args[0];
      if (!pseudo) return msg.reply('Usage : `-profil <pseudo>`');
      const user = await db.findUserBy('username', pseudo);
      if (!user) return msg.reply(`❌ Membre \`${pseudo}\` introuvable`);
      msg.reply(`🔗 https://ak-47.fr/${user.username}`);
    },
  },

  // ── Ban (admin) ───────────────────────────────────────────────────────────
  ban: {
    desc: '-ban <pseudo> [raison]',
    ownerOnly: true,
    async run(msg, args) {
      const [pseudo, ...rest] = args;
      if (!pseudo) return msg.reply('Usage : `-ban <pseudo> [raison]`');
      const raison = rest.join(' ') || 'Aucune raison';
      const user = await db.findUserBy('username', pseudo);
      if (!user) return msg.reply(`❌ Membre \`${pseudo}\` introuvable`);
      await db.updateUser(user.id, { banned: true });
      await db.addLog({ type: 'action', username: 'OWNER', detail: `Ban de @${user.username} — ${raison}`, ip: 'bot' });
      msg.reply(`✅ @${user.username} banni. Raison : ${raison}`);
    },
  },

  // ── Unban (admin) ─────────────────────────────────────────────────────────
  unban: {
    desc: '-unban <pseudo>',
    ownerOnly: true,
    async run(msg, args) {
      const pseudo = args[0];
      if (!pseudo) return msg.reply('Usage : `-unban <pseudo>`');
      const user = await db.findUserBy('username', pseudo);
      if (!user) return msg.reply(`❌ Membre \`${pseudo}\` introuvable`);
      await db.updateUser(user.id, { banned: false });
      await db.addLog({ type: 'action', username: 'OWNER', detail: `Unban de @${user.username}`, ip: 'bot' });
      msg.reply(`✅ @${user.username} débanni.`);
    },
  },

  // ── Logs (admin) ──────────────────────────────────────────────────────────
  logs: {
    desc: 'Derniers logs d\'activité',
    ownerOnly: true,
    async run(msg) {
      const logs = await db.getLogs({ limit: 10 });
      if (!logs.length) return msg.reply('Aucun log.');
      const lines = logs.map(l => {
        const date = new Date(l.created_at * 1000).toLocaleString('fr-FR');
        return `\`${date}\` **${l.type}** — ${l.username || '?'} — ${(l.detail || '').slice(0, 80)}`;
      }).join('\n');
      const embed = new EmbedBuilder().setColor(0x000000).setTitle('📋 Derniers logs').setDescription(lines).setTimestamp();
      msg.reply({ embeds: [embed] });
    },
  },

  // ── Honeypot (admin) ──────────────────────────────────────────────────────
  honeypot: {
    desc: 'Dernières tentatives d\'intrusion',
    ownerOnly: true,
    async run(msg) {
      const logs = await db.getLogs({ type: 'error', limit: 20 });
      const hp = logs.filter(l => l.username === 'INTRUSION');
      if (!hp.length) return msg.reply('✅ Aucune tentative détectée.');
      const lines = hp.map(l => {
        const date = new Date(l.created_at * 1000).toLocaleString('fr-FR');
        return `\`${date}\` — ${(l.detail || '').slice(0, 100)}`;
      }).join('\n');
      const embed = new EmbedBuilder().setColor(0xff1e1e).setTitle('🍯 Tentatives d\'intrusion').setDescription(lines).setTimestamp();
      msg.reply({ embeds: [embed] });
    },
  },
};

// ─── Listener messages ───────────────────────────────────────────────────────

client.on('messageCreate', async msg => {
  if (msg.author.bot) return;
  if (!msg.content.startsWith(PREFIX)) return;

  const [rawCmd, ...args] = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmdName = rawCmd.toLowerCase();
  const cmd = COMMANDS[cmdName];

  if (!cmd) return; // commande inconnue → silence

  if (cmd.ownerOnly && !isOwner(msg.author.id)) {
    return msg.reply('❌ Commande réservée au owner.');
  }

  try {
    await cmd.run(msg, args);
  } catch (e) {
    console.error(`Prefix command error [${cmdName}]:`, e.message);
    msg.reply('❌ Erreur : ' + e.message).catch(() => {});
  }
});

// ─── Ready ───────────────────────────────────────────────────────────────────

client.on('ready', async () => {
  console.log(`✅ Bot connecté : ${client.user.tag}`);
  client.user.setPresence({ status: 'online' });
  await refreshCarouselData();
  startCarousel();
  setInterval(async () => {
    await refreshCarouselData();
    startCarousel();
  }, 5 * 60 * 1000);
});

// ─── Guild join / rôles ──────────────────────────────────────────────────────

async function addMemberToGuild(discordUserId, accessToken) {
  if (!BOT_TOKEN) return;
  try {
    await api.put(`/guilds/${GUILD_ID}/members/${discordUserId}`, {
      access_token: accessToken,
      roles: [ROLE_MEMBRE],
    });
  } catch (err) {
    console.error('addMemberToGuild error:', err.response?.status, JSON.stringify(err.response?.data));
  }
}

async function getMemberRoles(discordUserId) {
  if (!BOT_TOKEN) return [];
  try {
    const r = await api.get(`/guilds/${GUILD_ID}/members/${discordUserId}`);
    return r.data.roles || [];
  } catch (err) {
    console.error('getMemberRoles error:', err.response?.data || err.message);
    return [];
  }
}

async function ensureMembreRole(discordUserId) {
  if (!BOT_TOKEN) return;
  try {
    const roles = await getMemberRoles(discordUserId);
    if (!roles.includes(ROLE_MEMBRE)) {
      await api.put(`/guilds/${GUILD_ID}/members/${discordUserId}/roles/${ROLE_MEMBRE}`);
    }
  } catch (err) {
    if (err.response?.status !== 403)
      console.error('ensureMembreRole error:', err.response?.data || err.message);
  }
}

async function fetchDiscordUserViaBot(discordUserId) {
  if (!BOT_TOKEN) return null;
  try {
    const r = await api.get(`/users/${discordUserId}`);
    return r.data;
  } catch (err) {
    console.error('fetchDiscordUserViaBot error:', err.response?.data || err.message);
    return null;
  }
}

// ─── Badges ──────────────────────────────────────────────────────────────────

const DISCORD_FLAGS = [
  { bit: 1 << 0,  type: 'staff',                label: 'Discord Staff',        emoji: '🛡️' },
  { bit: 1 << 1,  type: 'partner',              label: 'Discord Partner',      emoji: '🤝' },
  { bit: 1 << 2,  type: 'hypesquad',            label: 'HypeSquad Events',     emoji: '🎉' },
  { bit: 1 << 3,  type: 'bug_hunter',           label: 'Bug Hunter',           emoji: '🐛' },
  { bit: 1 << 6,  type: 'hypesquad_bravery',    label: 'HypeSquad Bravery',    emoji: '🟣' },
  { bit: 1 << 7,  type: 'hypesquad_brilliance', label: 'HypeSquad Brilliance', emoji: '🔴' },
  { bit: 1 << 8,  type: 'hypesquad_balance',    label: 'HypeSquad Balance',    emoji: '🟡' },
  { bit: 1 << 9,  type: 'early_supporter',      label: 'Early Supporter',      emoji: '👑' },
  { bit: 1 << 14, type: 'bug_hunter_level_2',   label: 'Bug Hunter Gold',      emoji: '🏅' },
  { bit: 1 << 17, type: 'verified_developer',   label: 'Verified Bot Dev',     emoji: '🤖' },
  { bit: 1 << 22, type: 'active_developer',     label: 'Active Developer',     emoji: '🔨' },
];

const NITRO_TYPES = {
  1: { label: 'Nitro Classic', emoji: '💠' },
  2: { label: 'Nitro',         emoji: '💎' },
  3: { label: 'Nitro Basic',   emoji: '🔹' },
};

function getDiscordBadges(discordUser) {
  const badges = [];
  const flags = discordUser.public_flags || 0;
  for (const { bit, type, label, emoji } of DISCORD_FLAGS) {
    if (flags & bit) badges.push({ label, emoji, type });
  }
  const nitro = NITRO_TYPES[discordUser.premium_type || 0];
  if (nitro) badges.push({ ...nitro, type: 'nitro' });
  return badges;
}

async function processDiscordLogin(discordUser, accessToken) {
  const discordId = discordUser.id;
  await addMemberToGuild(discordId, accessToken);
  await ensureMembreRole(discordId);
  const memberRoles = await getMemberRoles(discordId);
  const serverBadges = [];
  if (memberRoles.includes(ROLE_OWNER)) serverBadges.push({ label: 'Owner', emoji: '👑', type: 'owner' });
  if (memberRoles.includes(ROLE_STAFF)) serverBadges.push({ label: 'Staff', emoji: '🛡️', type: 'staff_server' });
  if (memberRoles.includes(ROLE_VIP))   serverBadges.push({ label: 'VIP',   emoji: '⭐', type: 'vip' });
  const botUser = await fetchDiscordUserViaBot(discordId);
  const userForBadges = botUser || discordUser;
  if (botUser && discordUser.premium_type) userForBadges.premium_type = discordUser.premium_type;
  const discordBadges = getDiscordBadges(userForBadges);
  return { badges: [...serverBadges, ...discordBadges], memberRoles };
}

// ─── Login ───────────────────────────────────────────────────────────────────

if (BOT_TOKEN) {
  client.login(BOT_TOKEN).catch(err => console.error('Bot login error:', err.message));
}

module.exports = { processDiscordLogin, getDiscordBadges };
