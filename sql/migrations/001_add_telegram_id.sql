-- ============================================================
-- Migración 001 — Agrega soporte de Telegram en usuarios
-- ============================================================
-- - Agrega columnas telegram_id y telegram_username
-- - Hace telefono opcional (ya no es obligatorio para usar el bot)
-- - Crea índice único en telegram_id (puede ser NULL)
-- ============================================================

USE casaflow;

ALTER TABLE usuarios
  ADD COLUMN telegram_id        BIGINT      NULL AFTER telefono,
  ADD COLUMN telegram_username  VARCHAR(64) NULL AFTER telegram_id,
  MODIFY COLUMN telefono VARCHAR(30) NULL;

-- Drop del unique anterior sobre telefono (si existe), permitir NULLs múltiples
-- En MySQL un UNIQUE permite varios NULL, así que basta con quitar NOT NULL.
ALTER TABLE usuarios ADD UNIQUE KEY uq_telegram_id (telegram_id);

-- Para que `mensaje_original` describa cualquier canal (no solo WhatsApp)
ALTER TABLE gastos
  ADD COLUMN canal VARCHAR(20) DEFAULT 'telegram' AFTER mensaje_original;
