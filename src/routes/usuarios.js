const router = require('express').Router()
const pool   = require('../db/pool')

// GET /api/usuarios?hogar_id=1
router.get('/', async (req, res) => {
  const { hogar_id } = req.query
  const [rows] = hogar_id
    ? await pool.query('SELECT * FROM usuarios WHERE hogar_id = ?', [hogar_id])
    : await pool.query('SELECT * FROM usuarios')
  res.json(rows)
})

// GET /api/usuarios/telefono/:tel  — útil para integraciones legacy
router.get('/telefono/:tel', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT u.*, h.nombre AS hogar_nombre FROM usuarios u JOIN hogares h ON h.id = u.hogar_id WHERE u.telefono = ?',
    [req.params.tel]
  )
  if (!rows.length) return res.status(404).json({ error: 'No encontrado' })
  res.json(rows[0])
})

// GET /api/usuarios/telegram/:id  — usado por el bot / Mini App
router.get('/telegram/:id', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT u.*, h.nombre AS hogar_nombre FROM usuarios u JOIN hogares h ON h.id = u.hogar_id WHERE u.telegram_id = ?',
    [req.params.id]
  )
  if (!rows.length) return res.status(404).json({ error: 'No encontrado' })
  res.json(rows[0])
})

// POST /api/usuarios   { hogar_id, nombre, telefono?, telegram_id?, telegram_username? }
router.post('/', async (req, res) => {
  const { hogar_id, nombre, telefono, telegram_id, telegram_username } = req.body
  if (!hogar_id || !nombre) return res.status(400).json({ error: 'hogar_id y nombre son requeridos' })
  try {
    const [r] = await pool.query(
      `INSERT INTO usuarios (hogar_id, nombre, telefono, telegram_id, telegram_username)
       VALUES (?, ?, ?, ?, ?)`,
      [hogar_id, nombre, telefono || null, telegram_id || null, telegram_username || null]
    )
    res.json({ ok: true, id: r.insertId })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Teléfono o telegram_id ya registrado' })
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/usuarios/:id/telegram   { telegram_id, telegram_username? }
router.patch('/:id/telegram', async (req, res) => {
  const { telegram_id, telegram_username } = req.body
  if (!telegram_id) return res.status(400).json({ error: 'telegram_id requerido' })
  try {
    await pool.query(
      'UPDATE usuarios SET telegram_id = ?, telegram_username = ? WHERE id = ?',
      [telegram_id, telegram_username || null, req.params.id]
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/hogares
router.get('/hogares', async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM hogares')
  res.json(rows)
})

// POST /api/hogares
router.post('/hogares', async (req, res) => {
  const { nombre } = req.body
  if (!nombre) return res.status(400).json({ error: 'nombre requerido' })
  const [r] = await pool.query('INSERT INTO hogares (nombre) VALUES (?)', [nombre])
  res.json({ ok: true, id: r.insertId })
})

module.exports = router
