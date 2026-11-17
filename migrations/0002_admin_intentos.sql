-- ==========================================================================
-- 0002_admin_intentos.sql — Límite de intentos de acceso al panel.
-- --------------------------------------------------------------------------
-- Guarda un hash de la IP (nunca la IP en claro) y cuántos intentos fallidos
-- hubo en los últimos 15 minutos. Se aplica igual que la migración inicial:
--
--   npx wrangler d1 migrations apply DB --local
--   npx wrangler d1 migrations apply DB --remote
-- ==========================================================================

CREATE TABLE IF NOT EXISTS admin_intentos (
  ip_hash        TEXT PRIMARY KEY,
  intentos       INTEGER NOT NULL DEFAULT 0,
  ultimo_intento INTEGER NOT NULL
);
