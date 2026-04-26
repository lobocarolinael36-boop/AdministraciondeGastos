const router = require('express').Router()
const pool   = require('../db/pool')

// GET /api/categorias
router.get('/', async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM categorias ORDER BY nombre')
  res.json(rows)
})

// GET /api/presupuestos?hogar_id=1&mes=4&anio=2026
router.get('/presupuestos', async (req, res) => {
  const { hogar_id, mes, anio } = req.query
  if (!hogar_id) return res.status(400).json({ error: 'hogar_id requerido' })
  const m = mes  || new Date().getMonth() + 1
  const a = anio || new Date().getFullYear()
  const [rows] = await pool.query(
    `SELECT p.*, c.nombre AS categoria, c.icono
     FROM presupuestos p JOIN categorias c ON c.id = p.categoria_id
     WHERE p.hogar_id = ? AND p.mes = ? AND p.anio = ?`,
    [hogar_id, m, a]
  )
  res.json(rows)
})

// PUT /api/presupuestos  — crea o actualiza (upsert)
router.put('/presupuestos', async (req, res) => {
  const { hogar_id, categoria_id, monto, mes, anio } = req.body
  if (!hogar_id || !categoria_id || !monto) return res.status(400).json({ error: 'Faltan campos' })
  const m = mes  || new Date().getMonth() + 1
  const a = anio || new Date().getFullYear()
  try {
    await pool.query(
      `INSERT INTO presupuestos (hogar_id, categoria_id, monto, mes, anio)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE monto = VALUES(monto)`,
      [hogar_id, categoria_id, monto, m, a]
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
