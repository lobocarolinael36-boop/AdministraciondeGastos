require('dotenv').config()
const express = require('express')
const cors    = require('cors')

const gastosRouter     = require('./routes/gastos')
const usuariosRouter   = require('./routes/usuarios')
const categoriasRouter = require('./routes/categorias')
const { parsearMensaje } = require('./ai/parser')

const app  = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`)
  next()
})

app.use('/api/gastos',     gastosRouter)
app.use('/api/usuarios',   usuariosRouter)
app.use('/api/categorias', categoriasRouter)

app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }))

app.post('/api/test/parsear', async (req, res) => {
  const { mensaje } = req.body
  if (!mensaje) return res.status(400).json({ error: 'mensaje requerido' })
  const result = await parsearMensaje(mensaje)
  res.json(result)
})

app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }))
app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'Error interno del servidor' })
})

app.listen(PORT, () => {
  console.log(`\n🏠 CasaFlow corriendo en http://localhost:${PORT}`)
  console.log(`   Modo IA: ${process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.startsWith('sk-...') ? 'OpenAI ✅' : 'Mock'}`)
  console.log(`   Endpoints:`)
  console.log(`     POST /api/gastos/mensaje`)
  console.log(`     GET  /api/gastos/resumen`)
  console.log(`     POST /api/test/parsear`)
  console.log(`     GET  /health\n`)
})

// ── Telegram ──────────────────────────────────────────────────
// Solo arranca si TELEGRAM_ENABLED=true y hay TELEGRAM_BOT_TOKEN
if (process.env.TELEGRAM_ENABLED === 'true') {
  const { iniciarTelegram } = require('./telegram/bot')
  iniciarTelegram().catch(err => {
    console.error('❌ Error iniciando bot de Telegram:', err.message)
  })
}
