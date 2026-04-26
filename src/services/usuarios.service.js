// ---------------------------------------------------------------
// Capa de lógica de USUARIOS
// Independiente del transporte (Telegram / REST / Mini App).
// ---------------------------------------------------------------
const pool = require('../db/pool')

// Buscar usuario por telegram_id (incluye datos del hogar)
async function buscarPorTelegramId(telegramId) {
  const [rows] = await pool.query(
    `SELECT u.*, h.nombre AS hogar_nombre
       FROM usuarios u
       JOIN hogares  h ON h.id = u.hogar_id
      WHERE u.telegram_id = ?`,
    [telegramId]
  )
  return rows[0] || null
}

// Buscar usuario por teléfono (legacy / vinculación)
async function buscarPorTelefono(telefono) {
  const [rows] = await pool.query(
    `SELECT u.*, h.nombre AS hogar_nombre
       FROM usuarios u
       JOIN hogares  h ON h.id = u.hogar_id
      WHERE u.telefono = ?`,
    [telefono]
  )
  return rows[0] || null
}

// Vincula un telegram_id a un usuario existente, identificado por su teléfono.
// Devuelve el usuario actualizado o null si no se encuentra.
async function vincularTelegram({ telefono, telegramId, telegramUsername }) {
  const usuario = await buscarPorTelefono(telefono)
  if (!usuario) return null

  await pool.query(
    `UPDATE usuarios
        SET telegram_id = ?, telegram_username = ?
      WHERE id = ?`,
    [telegramId, telegramUsername || null, usuario.id]
  )
  return await buscarPorTelegramId(telegramId)
}

module.exports = {
  buscarPorTelegramId,
  buscarPorTelefono,
  vincularTelegram,
}
