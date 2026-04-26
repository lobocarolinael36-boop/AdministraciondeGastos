require('dotenv').config()

// ---------------------------------------------------------------
// Mapa de categorías exportado — lo usan parser y bot
// ---------------------------------------------------------------
const KEYWORD_MAP = [
  { cat: 'Alquiler',        keys: ['alquiler', 'arriendo', 'rent'] },
  { cat: 'Supermercado',    keys: ['super', 'supermercado', 'coto', 'disco', 'carrefour', 'dia', 'jumbo', 'vital', 'comida', 'verdura', 'feria', 'almacen', 'fiambreria'] },
  { cat: 'Luz',             keys: ['luz', 'edesur', 'edenor', 'electricidad'] },
  { cat: 'Gas',             keys: ['gas', 'metrogas', 'garrafa'] },
  { cat: 'Internet',        keys: ['internet', 'wifi', 'fibra', 'fibertel', 'telecentro'] },
  { cat: 'Teléfono',        keys: ['telefono', 'celu', 'celular', 'linea', 'claro', 'personal', 'movistar'] },
  { cat: 'Salud',           keys: ['farmacia', 'remedio', 'medicina', 'medico', 'clinica', 'hospital', 'prepaga', 'osde', 'vaper', 'cigarrillo', 'tabaco'] },
  { cat: 'Transporte',      keys: ['colectivo', 'sube', 'uber', 'taxi', 'tren', 'subte', 'nafta', 'combustible'] },
  { cat: 'Entretenimiento', keys: ['netflix', 'spotify', 'disney', 'cine', 'teatro', 'restaurante', 'resto', 'bar', 'delivery', 'rappi'] },
]

const SYSTEM_PROMPT = `Sos un asistente que extrae información de gastos a partir de mensajes en español rioplatense.

Devolvé SIEMPRE un JSON válido con esta estructura exacta, sin texto adicional ni backticks:
{
  "monto": number | null,
  "descripcion": string,
  "categoria": string,
  "es_compartido": boolean,
  "fecha_gasto": "YYYY-MM-DD",
  "confianza": number
}

Categorías válidas (usá exactamente este texto):
Luz, Gas, Internet, Teléfono, Alquiler, Supermercado, Salud, Transporte, Entretenimiento, Otros

Reglas de montos:
- "14 lucas" = 14000
- "14k" = 14000
- "14 mil" = 14000
- "$14.500" = 14500
- "catorce mil" = 14000

Reglas de fecha:
- "ayer" = fecha de ayer
- "hoy", sin mención = fecha de hoy
- Devolvé siempre formato YYYY-MM-DD real, nunca el texto "HOY" o "AYER"

es_compartido = true si aparece: pagamos, dividimos, entre los dos, compartido, juntos, mitad y mitad

confianza: 0.0 a 1.0 — qué tan seguro estás de monto + categoría + si es compartido`

// ---------------------------------------------------------------
// Mock: usa regex y keywords cuando no hay clave de IA
// ---------------------------------------------------------------
function parseMock(mensaje, hoy, ayer) {
  const texto = mensaje.toLowerCase()

  let monto = null
  const lucasMatch = texto.match(/(\d+[\.,]?\d*)\s*lucas?/)
  const kMatch     = texto.match(/(\d+[\.,]?\d*)\s*k\b/)
  const milMatch   = texto.match(/(\d+[\.,]?\d*)\s*mil/)
  const numMatch   = texto.match(/\$?\s*(\d{2,}(?:[\.,]\d{3})*)/)

  if      (lucasMatch) monto = parseFloat(lucasMatch[1]) * 1000
  else if (kMatch)     monto = parseFloat(kMatch[1]) * 1000
  else if (milMatch)   monto = parseFloat(milMatch[1]) * 1000
  else if (numMatch)   monto = parseFloat(numMatch[1].replace(/\./g, '').replace(',', '.'))

  let categoria = 'Otros'
  for (const { cat, keys } of KEYWORD_MAP) {
    if (keys.some(k => texto.includes(k))) { categoria = cat; break }
  }

  const esCompartido = /pagamos|dividimos|entre los dos|compartido|juntos|mitad/i.test(mensaje)
  const fecha        = /\bayer\b/i.test(mensaje) ? ayer : hoy
  const descripcion  = mensaje.length > 60 ? mensaje.slice(0, 57) + '...' : mensaje
  const confianza    = monto !== null ? 0.75 : 0.5

  return { monto, descripcion, categoria, es_compartido: esCompartido, fecha_gasto: fecha, confianza }
}

// ---------------------------------------------------------------
// Parser principal — soporta OpenAI, Google Gemini, y mock
// Gemini: poner OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
//         y OPENAI_MODEL=gemini-1.5-flash
// ---------------------------------------------------------------
async function parsearMensaje(mensaje) {
  const hoy  = new Date().toISOString().split('T')[0]
  const ayer = new Date(Date.now() - 86400000).toISOString().split('T')[0]

  const apiKey = (process.env.OPENAI_API_KEY || '').trim()
  const tieneKey = apiKey.length > 10 && apiKey !== 'sk-...'

  if (!tieneKey) {
    console.log('⚠️  Modo mock (sin key de IA)')
    return parseMock(mensaje, hoy, ayer)
  }

  try {
    const { default: OpenAI } = await import('openai')
    const clientOpts = { apiKey }
    if (process.env.OPENAI_BASE_URL) clientOpts.baseURL = process.env.OPENAI_BASE_URL
    const client = new OpenAI(clientOpts)

    const resp = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: `Hoy es ${hoy}, ayer fue ${ayer}.\nMensaje: "${mensaje}"` }
      ],
      temperature: 0,
      max_tokens: 250,
      response_format: { type: 'json_object' },
    })

    return JSON.parse(resp.choices[0].message.content)

  } catch (err) {
    console.error('Error IA, usando mock:', err.message)
    return parseMock(mensaje, hoy, ayer)
  }
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
const UMBRAL_CONFIANZA = 0.65

function necesitaConfirmacion(parsed) {
  return parsed.confianza < UMBRAL_CONFIANZA || parsed.monto === null
}

function mensajeConfirmacion(parsed, nombre) {
  if (!parsed.monto) return `❓ *${nombre}*, no detecté el monto. ¿Cuánto fue?`
  const monto = parsed.monto.toLocaleString('es-AR')
  return `❓ *${nombre}*, confirmame:\n💰 $${monto} en ${parsed.categoria}${parsed.es_compartido ? ' (compartido)' : ''}\n¿Correcto? Respondé *sí* o correguime`
}

function mensajeExito(parsed, nombre) {
  const monto      = parsed.monto.toLocaleString('es-AR')
  const compartido = parsed.es_compartido ? ' (compartido 🤝)' : ''
  return `✅ *${nombre}*, registré:\n💰 $${monto} — ${parsed.descripcion}${compartido}\n📂 ${parsed.categoria}`
}

module.exports = { parsearMensaje, necesitaConfirmacion, mensajeConfirmacion, mensajeExito, KEYWORD_MAP }
