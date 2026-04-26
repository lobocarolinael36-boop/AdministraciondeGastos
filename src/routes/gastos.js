const router  = require('express').Router()
const pool    = require('../db/pool')
const { parsearMensaje } = require('../ai/parser')
const usuariosService = require('../services/usuarios.service')
const gastosService   = require('../services/gastos.service')

// ---------------------------------------------------------------
// POST /api/gastos/mensaje
// Carga un gasto desde texto natural.
// Body acepta { telegram_id, mensaje } (preferido) o { telefono, mensaje } (legacy).
// ---------------------------------------------------------------
router.post('/mensaje', async (req, res) => {
  const { telefono, telegram_id, mensaje, canal } = req.body
  if (!mensaje || (!telefono && !telegram_id)) {
    return res.status(400).json({ error: 'mensaje y (telegram_id o telefono) son requeridos' })
  }

  try {
    const usuario = telegram_id
      ? await usuariosService.buscarPorTelegramId(telegram_id)
      : await usuariosService.buscarPorTelefono(telefono)

    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' })

    const r = await gastosService.registrarGastoDesdeTexto({
      usuario,
      mensaje,
      canal: canal || (telegram_id ? 'telegram' : 'api'),
    })
    res.json(r)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------
// POST /api/gastos
// Carga directa (sin IA), para el dashboard
// ---------------------------------------------------------------
router.post('/', async (req, res) => {
  const { hogar_id, usuario_id, categoria_id, descripcion, monto, es_compartido, fecha_gasto } = req.body
  if (!hogar_id || !usuario_id || !monto) return res.status(400).json({ error: 'Faltan campos requeridos' })

  try {
    const fecha = fecha_gasto || new Date().toISOString().split('T')[0]
    const [result] = await pool.query(
      `INSERT INTO gastos (hogar_id, usuario_id, categoria_id, descripcion, monto, es_compartido, fecha_gasto)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [hogar_id, usuario_id, categoria_id || null, descripcion || '', monto, es_compartido || false, fecha]
    )
    res.json({ ok: true, gasto_id: result.insertId })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------
// GET /api/gastos?hogar_id=1&mes=4&anio=2026
// Lista gastos del mes con totales
// ---------------------------------------------------------------
router.get('/', async (req, res) => {
  const { hogar_id, mes, anio } = req.query
  if (!hogar_id) return res.status(400).json({ error: 'hogar_id requerido' })

  const m = mes  || new Date().getMonth() + 1
  const a = anio || new Date().getFullYear()

  try {
    const [gastos] = await pool.query(
      `SELECT g.*, u.nombre AS usuario_nombre, c.nombre AS categoria_nombre, c.icono
       FROM gastos g
       JOIN usuarios u ON u.id = g.usuario_id
       LEFT JOIN categorias c ON c.id = g.categoria_id
       WHERE g.hogar_id = ? AND MONTH(g.fecha_gasto) = ? AND YEAR(g.fecha_gasto) = ?
       ORDER BY g.fecha_gasto DESC`,
      [hogar_id, m, a]
    )
    res.json({ gastos, total: gastos.reduce((s, g) => s + Number(g.monto), 0) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------
// GET /api/gastos/resumen?hogar_id=1&mes=4&anio=2026
// Resumen: por categoría, por usuario, vs presupuesto
// ---------------------------------------------------------------
router.get('/resumen', async (req, res) => {
  const { hogar_id, mes, anio } = req.query
  if (!hogar_id) return res.status(400).json({ error: 'hogar_id requerido' })

  const m = mes  || new Date().getMonth() + 1
  const a = anio || new Date().getFullYear()

  try {
    // Totales por categoría
    const [porCategoria] = await pool.query(
      `SELECT c.nombre AS categoria, c.icono, SUM(g.monto) AS total, COUNT(*) AS cantidad
       FROM gastos g
       LEFT JOIN categorias c ON c.id = g.categoria_id
       WHERE g.hogar_id = ? AND MONTH(g.fecha_gasto) = ? AND YEAR(g.fecha_gasto) = ?
       GROUP BY g.categoria_id ORDER BY total DESC`,
      [hogar_id, m, a]
    )

    // Totales por usuario
    const [porUsuario] = await pool.query(
      `SELECT u.nombre, SUM(g.monto) AS total,
              SUM(CASE WHEN g.es_compartido THEN g.monto ELSE 0 END) AS compartido,
              SUM(CASE WHEN NOT g.es_compartido THEN g.monto ELSE 0 END) AS personal
       FROM gastos g JOIN usuarios u ON u.id = g.usuario_id
       WHERE g.hogar_id = ? AND MONTH(g.fecha_gasto) = ? AND YEAR(g.fecha_gasto) = ?
       GROUP BY g.usuario_id`,
      [hogar_id, m, a]
    )

    // Vs presupuesto
    const [presupuestos] = await pool.query(
      `SELECT c.nombre AS categoria, c.icono, p.monto AS presupuesto,
              COALESCE(SUM(g.monto), 0) AS gastado
       FROM presupuestos p
       JOIN categorias c ON c.id = p.categoria_id
       LEFT JOIN gastos g ON g.categoria_id = p.categoria_id
         AND g.hogar_id = p.hogar_id
         AND MONTH(g.fecha_gasto) = p.mes AND YEAR(g.fecha_gasto) = p.anio
       WHERE p.hogar_id = ? AND p.mes = ? AND p.anio = ?
       GROUP BY p.id`,
      [hogar_id, m, a]
    )

    const totalGeneral = porUsuario.reduce((s, u) => s + Number(u.total), 0)

    res.json({ mes: m, anio: a, totalGeneral, porCategoria, porUsuario, presupuestos })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------
// DELETE /api/gastos/:id
// ---------------------------------------------------------------
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM gastos WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
