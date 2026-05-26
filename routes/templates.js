const express = require('express');
const db = require('../models/db');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

const TEMPLATE_KEYS = [
  'bg_type','bg_value','bg_opacity','bg_url','bg_effect','bg_effect_color',
  'text_color','card_bg','card_opacity','profile_font',
  'accent_color','profile_blur','username_effect','glow_targets',
  'icon_color','monochrome_icons','animated_title','invert_blocks',
  'avatar_shape','avatar_decoration','link_layout','link_btn_style',
  'discord_presence',
];

router.get('/', async (req, res) => {
  try {
    const templates = await db.getTemplates({ limit: 100 });
    res.json(templates);
  } catch { res.status(500).json({ error: 'Erreur' }); }
});

router.get('/:id', async (req, res) => {
  try {
    const t = await db.getTemplateById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Modèle introuvable' });
    res.json(t);
  } catch { res.status(500).json({ error: 'Erreur' }); }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, description, preview_data } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Nom requis' });

    const user = await db.findUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const config = {};
    for (const k of TEMPLATE_KEYS) {
      if (user[k] !== undefined) config[k] = user[k];
    }

    const t = await db.createTemplate({
      user_id: req.user.id,
      username: user.username,
      name: name.trim().slice(0, 50),
      description,
      preview_data: preview_data || '',
      config,
    });
    res.json(t);
  } catch { res.status(500).json({ error: 'Erreur' }); }
});

router.post('/:id/use', authMiddleware, async (req, res) => {
  try {
    const t = await db.getTemplateById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Modèle introuvable' });

    let config = {};
    try { config = JSON.parse(t.config || '{}'); } catch {}

    await db.updateUser(req.user.id, config);
    await db.incrementTemplateUses(req.params.id);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erreur' }); }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const t = await db.getTemplateById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Introuvable' });
    if (t.user_id !== req.user.id) return res.status(403).json({ error: 'Interdit' });
    await db.deleteTemplate(req.params.id);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Erreur' }); }
});

module.exports = router;
