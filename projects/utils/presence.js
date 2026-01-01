// projects/utils/presence.js
const Presence = require("../models/presence");
const axios = require("axios");
const { httpsAgent } = require("../utils/httpsAgent");

const ACTIVE_WINDOW_MS = Number(process.env.PRESENCE_ACTIVE_WINDOW_MS || 15_000);
const USERS_MS = process.env.USERS_MS || "https://users:10001/";
const FREE_LIMIT = Number(process.env.PRESENCE_LIMIT_NON_PREMIUM || 2);

async function getUserType(userId) {
  if (!userId) return null;

  try {
    const resp = await axios.get(`${USERS_MS}${userId}/type`, {
      httpsAgent,
      timeout: 5000,
    });
    return resp.data?.type ?? null;
  } catch (err) {
    // Se o users-ms falhar, escolhe um comportamento conservador:
    // tratar como não-premium para não abrir ilimitado por acidente.
    return "free";
  }
}

async function ensureEditorSlot({ ownerId, projectId, callerId }) {
  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS);

  // limite depende do TIPO DO DONO (criador do projeto)
  const ownerType = await getUserType(ownerId);

  // Premium owner => ilimitado
  if (ownerType === "premium") {
    await Presence.updateOne(
      { ownerId, projectId, userId: callerId },
      { $set: { lastSeenAt: new Date() } },
      { upsert: true }
    );

    return { ok: true, ownerType, active: null, limit: null };
  }

  // Se já está ativo, refresca
  const existing = await Presence.findOne({ ownerId, projectId, userId: callerId });
  if (existing) {
    existing.lastSeenAt = new Date();
    await existing.save();

    const active = await Presence.countDocuments({
      ownerId,
      projectId,
      lastSeenAt: { $gte: cutoff },
    });

    return { ok: true, ownerType, active, limit: FREE_LIMIT };
  }

  // Contar ativos recentes
  const active = await Presence.countDocuments({
    ownerId,
    projectId,
    lastSeenAt: { $gte: cutoff },
  });

  if (active >= FREE_LIMIT) {
    return { ok: false, ownerType, active, limit: FREE_LIMIT };
  }

  // Ocupar slot
  await Presence.create({ ownerId, projectId, userId: callerId, lastSeenAt: new Date() });

  return { ok: true, ownerType, active: active + 1, limit: FREE_LIMIT };
}

async function releaseEditorSlot({ ownerId, projectId, callerId }) {
  await Presence.deleteOne({ ownerId, projectId, userId: callerId });
}

module.exports = { ensureEditorSlot, releaseEditorSlot };
