import { statfs } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { GINGA_VERSION } from "./version.js";

const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();

function mb(value: number) {
  return Math.max(0, Math.round((value / 1024 / 1024) * 10) / 10);
}

async function databaseHealth() {
  const before = performance.now();
  try {
    await prisma.$queryRawUnsafe(`SELECT 1 AS ok`);
    return { ok: true, latencyMs: Math.max(0, Math.round(performance.now() - before)) };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.max(0, Math.round(performance.now() - before)),
      error: error instanceof Error ? error.message.slice(0, 180) : "Falha ao consultar o PostgreSQL"
    };
  }
}

async function storageHealth() {
  const configuredPath = resolve(config.UPLOAD_DIR);
  let probePath = configuredPath;
  try {
    const stats = await statfs(probePath);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const availableBytes = Number(stats.bavail) * Number(stats.bsize);
    return {
      ok: totalBytes > 0,
      path: configuredPath,
      totalMb: mb(totalBytes),
      freeMb: mb(availableBytes),
      usedPercent: totalBytes > 0 ? Math.max(0, Math.min(100, Math.round(((totalBytes - availableBytes) / totalBytes) * 1000) / 10)) : 0
    };
  } catch {
    probePath = dirname(configuredPath);
    try {
      const stats = await statfs(probePath);
      const totalBytes = Number(stats.blocks) * Number(stats.bsize);
      const availableBytes = Number(stats.bavail) * Number(stats.bsize);
      return {
        ok: totalBytes > 0,
        path: configuredPath,
        totalMb: mb(totalBytes),
        freeMb: mb(availableBytes),
        usedPercent: totalBytes > 0 ? Math.max(0, Math.min(100, Math.round(((totalBytes - availableBytes) / totalBytes) * 1000) / 10)) : 0
      };
    } catch (error) {
      return {
        ok: false,
        path: configuredPath,
        totalMb: 0,
        freeMb: 0,
        usedPercent: 0,
        error: error instanceof Error ? error.message.slice(0, 180) : "Nao foi possivel consultar o armazenamento"
      };
    }
  }
}

async function liveKitHealth() {
  const url = config.LIVEKIT_INTERNAL_URL;
  const before = performance.now();
  try {
    // Qualquer resposta HTTP confirma que o processo/porta do LiveKit esta acessivel.
    // Nao dependemos de uma rota privada de administracao para o painel de saude.
    const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(1800) });
    return { ok: true, latencyMs: Math.max(0, Math.round(performance.now() - before)), statusCode: response.status, publicUrl: config.PUBLIC_LIVEKIT_URL };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.max(0, Math.round(performance.now() - before)),
      statusCode: null,
      publicUrl: config.PUBLIC_LIVEKIT_URL,
      error: error instanceof Error ? error.message.slice(0, 180) : "LiveKit indisponivel"
    };
  }
}

export async function readSystemHealth(socketClients = 0) {
  const [database, storage, livekit] = await Promise.all([databaseHealth(), storageHealth(), liveKitHealth()]);
  const memory = process.memoryUsage();
  return {
    status: database.ok && storage.ok && livekit.ok ? "healthy" : "degraded",
    version: GINGA_VERSION,
    timestamp: new Date().toISOString(),
    startedAt,
    uptimeSeconds: Math.floor(process.uptime()),
    environment: config.NODE_ENV,
    nodeVersion: process.version,
    process: {
      pid: process.pid,
      rssMb: mb(memory.rss),
      heapUsedMb: mb(memory.heapUsed),
      heapTotalMb: mb(memory.heapTotal)
    },
    database,
    storage,
    livekit,
    websocket: { ok: true, connectedClients: Math.max(0, Number(socketClients) || 0) }
  };
}
