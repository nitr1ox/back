const express = require('express');
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const db = require('../models/db');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');
const { processDiscordLogin } = require('../bot');
const router = express.Router();

function makeToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

router.get('/me', authMiddleware, async (req, res) => {
  const user = await db.findUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Introuvable' });
  const { password_hash, discord_access_token, ...safe } = user;
  res.json(safe);
});

const ALLOWED_FONTS = [
  'Inter','Roboto','Poppins','Montserrat','Lato','Nunito','Raleway',
  'Playfair Display','Space Grotesk','DM Sans','Syne','Outfit','Lexend',
  'Oswald','Ubuntu','Merriweather','Source Code Pro','Fira Code',
];

const SOCIAL_KEYS = [
  'twitter','instagram','tiktok','youtube','twitch','github',
  'discord','snapchat','linkedin','facebook','pinterest','reddit','steam',
];

router.patch('/me', authMiddleware, [
  body('display_name').optional().trim().isLength({ max: 50 }),
  body('bio').optional().trim().isLength({ max: 200 }),
  body('avatar_color').optional().matches(/^#[0-9a-fA-F]{6}$/),
  body('links').optional().isArray({ max: 20 }),
  body('hidden_badges').optional().isString(),

  body('avatar_url').optional().isString(),
  body('bg_url').optional().isString(),
  body('audio_url').optional().isString(),
  body('audio_name').optional().trim().isString().isLength({ max: 200 }),
  body('cursor_url').optional().isString(),

  body('avatar_shape').optional().isIn(['circle', 'rounded', 'square']),
  body('link_layout').optional().isIn(['list', 'grid', 'buttons']),
  body('link_btn_style').optional().isString().isLength({ max: 500 }),
  body('profile_font').optional().isIn(ALLOWED_FONTS),
  body('bg_type').optional().isIn(['color', 'gradient', 'image']),
  body('bg_value').optional().isString().isLength({ max: 300 }),
  body('bg_opacity').optional().isFloat({ min: 0, max: 1 }),
  body('text_color').optional().isString().isLength({ max: 7 }),
  body('card_bg').optional().isString().isLength({ max: 7 }),
  body('card_opacity').optional().isFloat({ min: 0, max: 1 }),
  body('banner_url').optional().isString(),
  body('social_links').optional().isString().isLength({ max: 2000 }),
  body('spotify_url').optional().isString().isLength({ max: 200 }),
  body('icon_color').optional().isString().isLength({ max: 7 }),
  body('monochrome_icons').optional().isBoolean(),
  body('animated_title').optional().isBoolean(),
  body('invert_blocks').optional().isBoolean(),
  body('use_discord_avatar').optional().isBoolean(),
  body('avatar_decoration').optional().isString().isLength({ max: 50 }),
  body('location').optional().trim().isLength({ max: 100 }),
  body('discord_presence').optional().isBoolean(),
  body('bg_effect').optional().isString().isLength({ max: 30 }),
  body('bg_effect_color').optional().matches(/^#[0-9a-fA-F]{6}$/),
  body('profile_blur').optional().isInt({ min: 0, max: 50 }),
  body('username_effect').optional().isString().isLength({ max: 30 }),
  body('glow_targets').optional().isString().isLength({ max: 200 }),
  body('accent_color').optional().matches(/^#[0-9a-fA-F]{6}$/),
  body('show_member_since').optional().isBoolean(),
  body('avatar_shine').optional().isBoolean(),
  body('profile_entrance').optional().isBoolean(),
  body('social_btn_style').optional().isIn(['circle','square','pill','ghost']),
  body('bio_font').optional().isString().isLength({ max: 50 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

  const {
    display_name, bio, avatar_color, links, hidden_badges,
    avatar_shape, link_layout, link_btn_style, profile_font,
    bg_type, bg_value, bg_opacity, text_color, card_bg, card_opacity, social_links, spotify_url,
    icon_color, monochrome_icons, animated_title, invert_blocks, use_discord_avatar, avatar_decoration,
    location, discord_presence, bg_effect, bg_effect_color,
    profile_blur, username_effect, glow_targets, accent_color,
    show_member_since, avatar_shine, profile_entrance, social_btn_style, bio_font,
  } = req.body;

  if (links) {
    for (const l of links) if (!l.title || !l.url) return res.status(400).json({ error: 'Chaque lien doit avoir un titre et une URL' });
  }

  if (social_links !== undefined) {
    try {
      const parsed = JSON.parse(social_links);
      const keys = Object.keys(parsed);
      for (const k of keys) {
        if (!SOCIAL_KEYS.includes(k)) return res.status(400).json({ error: `Réseau inconnu : ${k}` });
        if (typeof parsed[k] !== 'string' || parsed[k].length > 200) return res.status(400).json({ error: 'URL sociale invalide' });
      }
    } catch {
      return res.status(400).json({ error: 'social_links JSON invalide' });
    }
  }

  if (link_btn_style !== undefined) {
    try { JSON.parse(link_btn_style); } catch { return res.status(400).json({ error: 'link_btn_style JSON invalide' }); }
  }

  if (spotify_url !== undefined && spotify_url !== '') {
    if (!/^https:\/\/(open\.spotify\.com|spotify\.com)\//.test(spotify_url)) {
      return res.status(400).json({ error: 'URL Spotify invalide' });
    }
  }

  const fields = {};
  if (display_name   !== undefined) fields.display_name   = display_name;
  if (bio            !== undefined) fields.bio            = bio;
  if (avatar_color   !== undefined) fields.avatar_color   = avatar_color;
  if (links          !== undefined) fields.links          = links;
  if (hidden_badges  !== undefined) fields.hidden_badges  = hidden_badges;
  if (avatar_shape   !== undefined) fields.avatar_shape   = avatar_shape;
  if (link_layout    !== undefined) fields.link_layout    = link_layout;
  if (link_btn_style !== undefined) fields.link_btn_style = link_btn_style;
  if (profile_font   !== undefined) fields.profile_font   = profile_font;
  if (bg_type        !== undefined) fields.bg_type        = bg_type;
  if (bg_value       !== undefined) fields.bg_value       = bg_value;
  if (bg_opacity     !== undefined) fields.bg_opacity     = bg_opacity;
  if (text_color     !== undefined) fields.text_color     = text_color;
  if (card_bg        !== undefined) fields.card_bg        = card_bg;
  if (card_opacity   !== undefined) fields.card_opacity   = card_opacity;
  if (social_links   !== undefined) fields.social_links   = social_links;
  if (spotify_url    !== undefined) fields.spotify_url    = spotify_url;
  if (icon_color           !== undefined) fields.icon_color           = icon_color;
  if (monochrome_icons     !== undefined) fields.monochrome_icons     = monochrome_icons;
  if (animated_title       !== undefined) fields.animated_title       = animated_title;
  if (invert_blocks        !== undefined) fields.invert_blocks        = invert_blocks;
  if (use_discord_avatar   !== undefined) fields.use_discord_avatar   = use_discord_avatar;
  if (avatar_decoration    !== undefined) fields.avatar_decoration    = avatar_decoration;
  if (location             !== undefined) fields.location             = location;
  if (discord_presence     !== undefined) fields.discord_presence     = discord_presence;
  if (bg_effect            !== undefined) fields.bg_effect            = bg_effect;
  if (bg_effect_color      !== undefined) fields.bg_effect_color      = bg_effect_color;
  if (profile_blur         !== undefined) fields.profile_blur         = profile_blur;
  if (username_effect      !== undefined) fields.username_effect      = username_effect;
  if (glow_targets         !== undefined) fields.glow_targets         = glow_targets;
  if (accent_color         !== undefined) fields.accent_color         = accent_color;
  if (show_member_since    !== undefined) fields.show_member_since    = show_member_since;
  if (avatar_shine         !== undefined) fields.avatar_shine         = avatar_shine;
  if (profile_entrance     !== undefined) fields.profile_entrance     = profile_entrance;
  if (social_btn_style     !== undefined) fields.social_btn_style     = social_btn_style;
  if (bio_font             !== undefined) fields.bio_font             = bio_font;

  const { avatar_url, bg_url, audio_url, audio_name, cursor_url, banner_url } = req.body;
  const MAX_DEFAULT = 5 * 1024 * 1024 * 1.37;
  const MAX_BG       = 50 * 1024 * 1024 * 1.37;
  const MAX_AUDIO    = 8  * 1024 * 1024 * 1.37;
  if (avatar_url  !== undefined) { if (avatar_url.length  > MAX_DEFAULT) return res.status(400).json({ error: 'Avatar trop lourd (max 5MB)' });        fields.avatar_url  = avatar_url; }
  if (bg_url      !== undefined) { if (bg_url.length      > MAX_BG)      return res.status(400).json({ error: 'Arrière-plan trop lourd (max 50MB)' }); fields.bg_url      = bg_url; }
  if (audio_url   !== undefined) { if (audio_url.length   > MAX_AUDIO)   return res.status(400).json({ error: 'Audio trop lourd (max 8MB)' });          fields.audio_url   = audio_url; }
  if (audio_name  !== undefined) fields.audio_name  = audio_name;
  if (cursor_url  !== undefined) { if (cursor_url.length  > MAX_DEFAULT) return res.status(400).json({ error: 'Curseur trop lourd (max 5MB)' });         fields.cursor_url  = cursor_url; }
  if (banner_url  !== undefined) { if (banner_url.length  > MAX_BG)      return res.status(400).json({ error: 'Bannière trop lourde (max 50MB)' });      fields.banner_url  = banner_url; }

  if (!Object.keys(fields).length) return res.status(400).json({ error: 'Rien à mettre à jour' });

  const updated = await db.updateUser(req.user.id, fields);
  const { password_hash, discord_access_token, ...safe } = updated;
  res.json(safe);
});

router.get('/discord-avatar', authMiddleware, async (req, res) => {
  const user = await db.findUserById(req.user.id);
  if (!user || !user.discord_id) return res.status(400).json({ error: 'Compte Discord non lié' });
  try {
    const { discord_id } = user;
    const meta = JSON.parse(user.oauth_meta || '{}');
    const access_token = user.discord_access_token || meta.discord_access_token;
    if (!access_token) return res.status(400).json({ error: 'Token Discord manquant' });
    const r = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!r.ok) return res.status(400).json({ error: 'Discord API error' });
    const d = await r.json();
    const avatarUrl = d.avatar
      ? `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png?size=256`
      : `https://cdn.discordapp.com/embed/avatars/${parseInt(d.discriminator || 0) % 5}.png`
    res.json({ avatar_url: avatarUrl });
  } catch (err) {
    res.status(500).json({ error: 'Impossible de récupérer l\'avatar Discord' });
  }
});

const RESERVED = ['admin','api','login','register','dashboard','settings','leaderboard','status','recovery','help','terms','privacy','support','www','setup'];

router.get('/check-username', async (req, res) => {
  const username = (req.query.username || '').trim().toLowerCase();
  if (!username || username.length < 2) return res.json({ available: false });
  if (RESERVED.includes(username)) return res.json({ available: false });
  const existing = await db.findUserBy('username', username);
  res.json({ available: !existing });
});

router.patch('/setup-username', authMiddleware, async (req, res) => {
  const username = (req.body.username || '').trim().toLowerCase();
  if (!username || username.length < 2 || username.length > 30) return res.status(400).json({ error: 'Pseudo invalide' });
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) return res.status(400).json({ error: 'Pseudo invalide' });
  if (RESERVED.includes(username)) return res.status(400).json({ error: 'Ce pseudo est réservé' });

  const current = await db.findUserById(req.user.id);
  if (current && (current.oauth_meta === '{}' || !current.oauth_meta) && current.password_hash !== '__oauth__') {
    return res.status(400).json({ error: 'Pseudo déjà configuré' });
  }

  const existing = await db.findUserBy('username', username);
  if (existing && existing.id !== req.user.id) return res.status(409).json({ error: 'Pseudo déjà pris' });

  const updated = await db.updateUser(req.user.id, { username });
  const { password_hash, ...safe } = updated;
  const token = makeToken(updated);
  res.json({ ...safe, token });
});

router.post('/sync-discord', authMiddleware, async (req, res) => {
  const user = await db.findUserById(req.user.id);
  if (!user || !user.discord_id || !user.discord_access_token) {
    return res.status(400).json({ error: 'Compte Discord non lié' });
  }
  try {

    const r = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${user.discord_access_token}` },
    });
    if (!r.ok) return res.status(400).json({ error: 'Token Discord expiré, relie ton compte Discord depuis les paramètres' });
    const discordUser = await r.json();
    const { badges } = await processDiscordLogin(discordUser, user.discord_access_token);
    const discord_badges = JSON.stringify(badges);
    await db.updateUser(user.id, { discord_badges });
    res.json({ success: true, discord_badges });
  } catch (err) {
    console.error('sync-discord error:', err.message);
    res.status(500).json({ error: 'Impossible de synchroniser Discord' });
  }
});

router.delete('/badges', authMiddleware, async (req, res) => {
  try {
    await db.updateUser(req.user.id, { discord_badges: '[]' });
    res.json({ success: true });
  } catch (err) {
    console.error('delete badges error:', err.message);
    res.status(500).json({ error: 'Impossible de supprimer les badges' });
  }
});

router.post('/unlink/discord', authMiddleware, async (req, res) => {
  try {
    await db.updateUser(req.user.id, {
      discord_id: null,
      discord_badges: '[]',
      discord_access_token: null,
      discord_username: null,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('unlink discord error:', err.message);
    res.status(500).json({ error: 'Impossible de délier Discord' });
  }
});

router.post('/unlink/google', authMiddleware, async (req, res) => {
  try {
    await db.updateUser(req.user.id, { google_id: null });
    res.json({ success: true });
  } catch (err) {
    console.error('unlink google error:', err.message);
    res.status(500).json({ error: 'Impossible de délier Google' });
  }
});

module.exports = router;
