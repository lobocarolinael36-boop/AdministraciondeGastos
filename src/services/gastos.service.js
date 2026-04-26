// ---------------------------------------------------------------
// Capa de lógica de GASTOS
// Toda la lógica de negocio vive acá: registrar, resumen, saldo.
// El transporte (Telegram, REST, Mini App) consume estas funciones.
// ---------------------------------------------------------------
const pool = require('../db/pool')
const {
  parsearMensaje,
  necesitaConfirmacion,
  mensajeConfirmacion,
  mensajeExito,
} = require('../ai/parser')

// ---------------------------------------------------------------
// Procesa un mensaje natural del usuario y registra el gasto.
// Devuelve { ok, respuesta, gasto?, parsed }
//   - ok=false si necesita confirmación o no hay monto
//   - ok=true si se registró correctamente
// ---------------------------------------------------------------
async function registrarGastoDesdeTexto({ usuario, mensaje, canal = 'telegram' }) {
  const parsed = await parsearMensaje(mensaje)

  if (necesitaConfirmacion(parsed)) {
    return {
      ok: false,
      pendienteConfirmacion: true,
      respuesta: mensajeConfirmacion(parsed, usuario.nombre),
      parsed,
    }
  }

  const [cats] = await pool.query(
    'SELECT id FROM categorias WHERE nombre = ?',
    [parsed.categoria]
  )
  const categoria_id = cats.length ? cats[0].id : null

  const [result] = await pool.query(
    `INSERT INTO gastos
       (hogar_id, usuario_id, categoria_id, descripcion, monto,
        es_compartido, mensaje_original, canal, fecha_gasto)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      usuario.hogar_id,
      usuario.id,
      categoria_id,
      parsed.descripcion,
      parsed.monto,
      parsed.es_compartido,
      mensaje,
      canal,
      parsed.fecha_gasto,
    ]
  )

  return {
    ok: true,
    gasto_id: result.insertId,
    respuesta: mensajeExito(parsed, usuario.nombre),
    parsed,
  }
}

// ---------------------------------------------------------------
// Resumen del mes (texto formateado, listo para mandar al chat).
// ---------------------------------------------------------------
async function resumenDelMes({ hogar_id, mes, anio }) {
  const m = mes  || new Date().getMonth() + 1
  const a = anio || new Date().getFullYear()

  const [porCategoria] = await pool.query(
    `SELECT c.nombre AS categoria, c.icono,
            SUM(g.monto) AS total, COUNT(*) AS cantidad
       FROM gastos g
       LEFT JOIN categorias c ON c.id = g.categoria_id
      WHERE g.hogar_id = ?
        AND MONTH(g.fecha_gasto) = ?
        AND YEAR(g.fecha_gasto)  = ?
      GROUP BY g.categoria_id
      ORDER BY total DESC`,
    [hogar_id, m, a]
  )

  const [porUsuario] = await pool.query(
    `SELECT u.nombre, SUM(g.monto) AS total
       FROM gastos g
       JOIN usuarios u ON u.id = g.usuario_id
      WHERE g.hogar_id = ?
        AND MONTH(g.fecha_gasto) = ?
        AND YEAR(g.fecha_gasto)  = ?
      GROUP BY g.usuario_id`,
    [hogar_id, m, a]
  )

  const totalGeneral = porUsuario.reduce((s, u) => s + Number(u.total), 0)
  return { mes: m, anio: a, totalGeneral, porCategoria, porUsuario }
}

// ---------------------------------------------------------------
// Saldo del usuario actual: cuánto gastó él/ella en el mes.
// ---------------------------------------------------------------
async function saldoDelUsuario({ usuario, mes, anio }) {
  const m = mes  || new Date().getMonth() + 1
  const a = anio || new Date().getFullYear()

  const [rows] = await pool.query(
    `SELECT
       COALESCE(SUM(monto), 0)                                    AS total,
       COALESCE(SUM(CASE WHEN es_compartido     THEN monto END), 0) AS compartido,
       COALESCE(SUM(CASE WHEN NOT es_compartido THEN monto END), 0) AS personal,
       COUNT(*) AS cantidad
       FROM gastos
      WHERE usuario_id = ?
        AND MONTH(fecha_gasto) = ?
        AND YEAR(fecha_gasto)  = ?`,
    [usuario.id, m, a]
  )
  return { mes: m, anio: a, ...rows[0] }
}

// ---------------------------------------------------------------
// Lista de categorías disponibles (con ícono).
// ---------------------------------------------------------------
async function listarCategorias() {
  const [rows] = await pool.query('SELECT * FROM categorias ORDER BY nombre')
  return rows
}

// ---------------------------------------------------------------
// Registra un gasto a partir de un objeto ya parseado (confirmación).
// ---------------------------------------------------------------
async function confirmarGasto({ usuario, parsed, canal = 'telegram' }) {
  const [cats] = await pool.query(
    'SELECT id FROM categorias WHERE nombre = ?',
    [parsed.categoria]
  )
  const categoria_id = cats.length ? cats[0].id : null

  const [result] = await pool.query(
    `INSERT INTO gastos
       (hogar_id, usuario_id, categoria_id, descripcion, monto,
        es_compartido, mensaje_original, canal, fecha_gasto)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      usuario.hogar_id,
      usuario.id,
      categoria_id,
      parsed.descripcion,
      parsed.monto,
      parsed.es_compartido,
      parsed.descripcion,
      canal,
      parsed.fecha_gasto,
    ]
  )

  return { ok: true, gasto_id: result.insertId }
}

module.exports = {
  registrarGastoDesdeTexto,
  confirmarGasto,
  resumenDelMes,
  saldoDelUsuario,
  listarCategorias,
}
