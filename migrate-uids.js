/**
 * migrate-uids.js
 * ---------------
 * Assigne un UID aux utilisateurs qui n'en ont pas.
 * Le compteur meta/user_counter est respecté : les nouveaux UIDs
 * partent de max(user_counter, uid_max_existant) + 1.
 *
 * Usage : node migrate-uids.js
 * (lancer depuis le dossier backend avec le .env configuré)
 */

require('dotenv').config();
const admin = require('firebase-admin');

// ── Init Firebase ──────────────────────────────────────────────
if (!admin.apps.length) {
  let credential;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
    credential = admin.credential.cert(sa);
  } else {
    credential = admin.credential.applicationDefault();
  }
  admin.initializeApp({
    credential,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

const db = admin.database();

async function migrateUids() {
  console.log('🔍 Chargement de tous les utilisateurs...');
  const snap = await db.ref('users').once('value');
  const val = snap.val();

  if (!val) {
    console.log('Aucun utilisateur trouvé.');
    process.exit(0);
  }

  const entries = Object.entries(val); // [fbKey, userData]

  // Utilisateurs sans UID
  const toMigrate = entries.filter(([, u]) => u.uid === undefined || u.uid === null);
  // UIDs déjà attribués
  const existingUids = entries
    .map(([, u]) => u.uid)
    .filter(uid => typeof uid === 'number' && uid > 0);

  const maxExistingUid = existingUids.length > 0 ? Math.max(...existingUids) : 0;

  // Lire le compteur actuel
  const counterSnap = await db.ref('meta/user_counter').once('value');
  const currentCounter = counterSnap.val() || 0;

  // On repart du max pour ne pas créer de doublons
  let nextUid = Math.max(maxExistingUid, currentCounter);

  console.log(`📊 Total users        : ${entries.length}`);
  console.log(`✅ Avec UID           : ${entries.length - toMigrate.length}`);
  console.log(`⚠️  Sans UID (à migrer): ${toMigrate.length}`);
  console.log(`🔢 Prochain UID       : ${nextUid + 1}`);

  if (toMigrate.length === 0) {
    console.log('\n✅ Tous les utilisateurs ont déjà un UID. Rien à faire.');
    process.exit(0);
  }

  // Trier par created_at pour attribuer les UIDs dans l'ordre chronologique
  toMigrate.sort(([, a], [, b]) => (a.created_at || 0) - (b.created_at || 0));

  console.log('\n🚀 Migration en cours...\n');

  for (const [fbKey, user] of toMigrate) {
    nextUid++;
    await db.ref(`users/${fbKey}`).update({ uid: nextUid });
    console.log(`  ✔ @${(user.username || user.id).padEnd(24)} → uid #${nextUid}`);
  }

  // Mettre à jour le compteur
  await db.ref('meta/user_counter').set(nextUid);

  console.log(`\n✅ Migration terminée. ${toMigrate.length} utilisateur(s) mis à jour.`);
  console.log(`🔢 Compteur mis à jour : meta/user_counter = ${nextUid}`);
  process.exit(0);
}

migrateUids().catch(err => {
  console.error('❌ Erreur migration :', err);
  process.exit(1);
});
