// ---------------------------------------------------------------
// Capa de TRANSPORTE — Telegram
// Recibe mensajes/comandos y delega en services/*.
// ---------------------------------------------------------------
const TelegramBot = require('node-telegram-bot-api')
const cron        = require('node-cron')
const pool        = require('../db/pool')

const usuariosService              = require('../services/usuarios.service')
const gastosService                = require('../services/gastos.service')
const { parsearMensaje, mensajeExito, KEYWORD_MAP } = require('../ai/parser')

// ---------------------------------------------------------------
// Estado de conversaciones pendientes
// chatId → { parsed, usuario, fase: 'revision' | 'esperando_monto' }
// ---------------------------------------------------------------
const pendientes = new Map()

// ---------------------------------------------------------------
// Helpers de detección para correcciones en lenguaje natural
// ---------------------------------------------------------------
function detectarCategoria(texto) {
  const t = texto.toLowerCase()
  const directas = {
    'luz': 'Luz', 'electricidad': 'Luz', 'edesur': 'Luz', 'edenor': 'Luz',
    'gas': 'Gas', 'metrogas': 'Gas', 'garrafa': 'Gas',
    'internet': 'Internet', 'wifi': 'Internet', 'fibra': 'Internet',
    'telefono': 'Teléfono', 'teléfono': 'Teléfono', 'celu': 'Teléfono', 'celular': 'Teléfono',
    'alquiler': 'Alquiler', 'arriendo': 'Alquiler',
    'super': 'Supermercado', 'supermercado': 'Supermercado', 'mercado': 'Supermercado',
    'salud': 'Salud', 'farmacia': 'Salud', 'medico': 'Salud', 'medicina': 'Salud',
    'transporte': 'Transporte', 'nafta': 'Transporte', 'uber': 'Transporte', 'subte': 'Transporte',
    'entretenimiento': 'Entretenimiento', 'cine': 'Entretenimiento',
    'restaurante': 'Entretenimiento', 'resto': 'Entretenimiento', 'bar': 'Entretenimiento',
    'otros': 'Otros',
  }
  for (const [key, cat] of Object.entries(directas)) {
    if (t.includes(key)) return cat
  }
  for (const { cat, keys } of KEYWORD_MAP) {
    if (keys.some(k => t.includes(k))) return cat
  }
  return null
}

function detectarMonto(texto) {
  const t = texto.toLowerCase()
  const lucasMatch = t.match(/(\d+[\.,]?\d*)\s*lucas?/)
  const kMatch     = t.match(/(\d+[\.,]?\d*)\s*k\b/)
  const milMatch   = t.match(/(\d+[\.,]?\d*)\s*mil/)
  const numMatch   = t.match(/\$?\s*(\d{2,}(?:[\.,]\d{3})*)/)
  if (lucasMatch) return parseFloat(lucasMatch[1]) * 1000
  if (kMatch)     return parseFloat(kMatch[1]) * 1000
  if (milMatch)   return parseFloat(milMatch[1]) * 1000
  if (numMatch)   return parseFloat(numMatch[1].replace(/\./g, '').replace(',', '.'))
  return null
}

// ---------------------------------------------------------------
// Textos del bot
// ---------------------------------------------------------------
const fmt = (n) => Number(n || 0).toLocaleString('es-AR')

function esComando(texto) {
  return typeof texto === 'string' && texto.trim().startsWith('/')
}

function esGaludo(texto) {
  return /^(hola|buenas|hey|buen\s?d[ií]a|buenos\s?d[ií]as|buenas\s?tardes|buenas\s?noches|holaa|holis)\b/i.test(texto.trim())
}

function textoRevision(parsed) {
  const hoy  = new Date().toISOString().split('T')[0]
  const ayer = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  const monto     = Number(parsed.monto).toLocaleString('es-AR')
  const compartido = parsed.es_compartido ? '👥 Compartido' : '👤 Personal'
  let fechaLabel
  if (parsed.fecha_gasto === hoy)       fechaLabel = '📅 Hoy'
  else if (parsed.fecha_gasto === ayer) fechaLabel = '📅 Ayer'
  else                                  fechaLabel = `📅 ${parsed.fecha_gasto}`

  return (
`📋 *Revisá antes de guardar*

💰 $${monto}
📂 ${parsed.categoria}
${fechaLabel}
${compartido}

Respondé *sí* para guardar, o corregime:
_"es salud"_ · _"son 65k"_ · _"es compartido"_ · _"no"_ para cancelar`
  )
}

function textoBienvenida(nombre) {
  return (
`👋 Hola *${nombre}*! Soy tu asistente de gastos.

Mandame un mensaje natural como:
• "pagué 14 lucas de luz"
• "gasté 18500 en el super"
• "ayer pagamos 80mil de alquiler entre los dos"

Comandos disponibles: /help`
  )
}

function textoVincular(telegramId) {
  return (
`👋 Tu cuenta de Telegram aún no está vinculada.

Tu \`telegram_id\` es: \`${telegramId}\`

Para vincularte mandá:
\`/vincular <tu-telefono>\`

Ejemplo: \`/vincular 5491100000001\``
  )
}

function textoAyuda() {
  return (
`📖 *Cómo usar CasaFlow*

✏️ *Cargar un gasto* — mandá un mensaje normal:
• "14 lucas de luz"
• "gasté 9500 en farmacia"
• "pagamos 80mil de alquiler entre los dos"

El bot siempre te muestra un resumen para que confirmes antes de guardar. Podés corregir categoría, monto o si es compartido antes de decir *sí*.

📊 *Comandos*
/start           — Iniciar / vincular cuenta
/resumen         — Resumen del mes
/saldo           — Tus gastos del mes
/categorias      — Lista de categorías
/vincular <tel>  — Vincular tu Telegram
/help            — Esta ayuda`
  )
}

function textoResumen(resumen) {
  const cats = resumen.porCategoria.length
    ? resumen.porCategoria
        .map(c => `${c.icono || '📦'} ${c.categoria || 'Sin categoría'} — $${fmt(c.total)}`)
        .join('\n')
    : '_Sin gastos este mes_'
  const usrs = resumen.porUsuario.length
    ? resumen.porUsuario.map(u => `• ${u.nombre}: $${fmt(u.total)}`).join('\n')
    : ''
  return (
`📊 *Resumen ${String(resumen.mes).padStart(2,'0')}/${resumen.anio}*

*Total del hogar:* $${fmt(resumen.totalGeneral)}

*Por categoría:*
${cats}
${usrs ? `\n*Por persona:*\n${usrs}` : ''}`
  )
}

function textoSaldo(usuario, saldo) {
  return (
`💰 *${usuario.nombre}* — ${String(saldo.mes).padStart(2,'0')}/${saldo.anio}

Total gastado: *$${fmt(saldo.total)}*
• Personal:    $${fmt(saldo.personal)}
• Compartido:  $${fmt(saldo.compartido)}
• Movimientos: ${saldo.cantidad}`
  )
}

function textoCategorias(cats) {
  return '📂 *Categorías disponibles*\n\n' +
    cats.map(c => `${c.icono || '📦'} ${c.nombre}`).join('\n')
}

// ---------------------------------------------------------------
// Reminder diario — usuarios sin gastos hoy
// ---------------------------------------------------------------
async function enviarRecordatorios(bot) {
  const hoy = new Date().toISOString().split('T')[0]
  try {
    const [usuarios] = await pool.query(
      `SELECT u.id, u.nombre, u.telegram_id
         FROM usuarios u
        WHERE u.telegram_id IS NOT NULL`
    )
    for (const u of usuarios) {
      const [gastos] = await pool.query(
        `SELECT COUNT(*) AS total FROM gastos
          WHERE usuario_id = ? AND DATE(fecha_gasto) = ?`,
        [u.id, hoy]
      )
      if (gastos[0].total === 0) {
        await bot.sendMessage(u.telegram_id,
          `🔔 *${u.nombre}*, ¿registraste algún gasto hoy?\n\nSi gastaste algo, contame y lo anoto 📝`,
          { parse_mode: 'Markdown' }
        ).catch(err => console.error(`Reminder a ${u.nombre} falló:`, err.message))
      }
    }
  } catch (err) {
    console.error('Error enviando recordatorios:', err.message)
  }
}

// ---------------------------------------------------------------
// Bot principal
// ---------------------------------------------------------------
async function iniciarTelegram() {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    console.warn('⚠️  TELEGRAM_BOT_TOKEN no está definido en .env — bot NO arranca')
    return null
  }

  const bot = new TelegramBot(token, { polling: false })

  // Borrar webhook antes de arrancar polling
  try {
    const info = await bot.getWebHookInfo()
    if (info && info.url) {
      console.log(`⚠️  Webhook activo (${info.url}) — borrando...`)
      await bot.deleteWebHook()
      console.log('✅ Webhook borrado')
    } else {
      console.log('✅ Sin webhook previo — OK')
    }
  } catch (err) {
    console.error('⚠️  No pude verificar/borrar webhook:', err.message)
  }

  bot.startPolling({ polling: { interval: 300, autoStart: true } })

  // Helper de envío con fallback sin Markdown
  const reply = async (chatId, text) => {
    try {
      return await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' })
    } catch (err) {
      console.error('Markdown falló, reintentando sin formato:', err.message)
      return bot.sendMessage(chatId, text.replace(/[*_`]/g, ''))
    }
  }

  // ─── /start ────────────────────────────────────────────────
  bot.onText(/^\/start(?:@\w+)?\s*$/i, async (msg) => {
    console.log(`[/start] from ${msg.from.id}`)
    try {
      const usuario = await usuariosService.buscarPorTelegramId(msg.from.id)
      if (!usuario) return reply(msg.chat.id, textoVincular(msg.from.id))
      return reply(msg.chat.id, textoBienvenida(usuario.nombre))
    } catch (err) {
      console.error('Error /start:', err.message)
      return reply(msg.chat.id, '⚠️ Hubo un problema al iniciar. Intentá de nuevo.')
    }
  })

  // ─── /help ─────────────────────────────────────────────────
  bot.onText(/^\/help(?:@\w+)?\s*$/i, async (msg) => {
    console.log(`[/help] from ${msg.from.id}`)
    try { return reply(msg.chat.id, textoAyuda()) }
    catch (err) { console.error('Error /help:', err.message) }
  })

  // ─── /vincular <telefono> ──────────────────────────────────
  bot.onText(/^\/vincular(?:@\w+)?\s+(\S+)\s*$/i, async (msg, match) => {
    const telefono = match[1].replace(/\D/g, '')
    console.log(`[/vincular] from ${msg.from.id}, tel: ${telefono}`)
    try {
      const usuario = await usuariosService.vincularTelegram({
        telefono,
        telegramId: msg.from.id,
        telegramUsername: msg.from.username,
      })
      if (!usuario) {
        return reply(msg.chat.id,
          `❌ No encontré un usuario con teléfono \`${telefono}\`.\nPedile al administrador que te dé de alta.`)
      }
      return reply(msg.chat.id,
        `✅ Listo, *${usuario.nombre}*. Tu Telegram quedó vinculado al hogar *${usuario.hogar_nombre}*.\n\nMandá /help para ver qué podés hacer.`)
    } catch (err) {
      console.error('Error /vincular:', err.message)
      return reply(msg.chat.id, '⚠️ No pude vincularte. Intentá de nuevo en un rato.')
    }
  })

  // ─── /resumen ──────────────────────────────────────────────
  bot.onText(/^\/resumen(?:@\w+)?\s*$/i, async (msg) => {
    console.log(`[/resumen] from ${msg.from.id}`)
    try {
      const usuario = await usuariosService.buscarPorTelegramId(msg.from.id)
      if (!usuario) return reply(msg.chat.id, textoVincular(msg.from.id))
      const resumen = await gastosService.resumenDelMes({ hogar_id: usuario.hogar_id })
      return reply(msg.chat.id, textoResumen(resumen))
    } catch (err) {
      console.error('Error /resumen:', err.message)
      return reply(msg.chat.id, '⚠️ No pude calcular el resumen.')
    }
  })

  // ─── /saldo ────────────────────────────────────────────────
  bot.onText(/^\/saldo(?:@\w+)?\s*$/i, async (msg) => {
    console.log(`[/saldo] from ${msg.from.id}`)
    try {
      const usuario = await usuariosService.buscarPorTelegramId(msg.from.id)
      if (!usuario) return reply(msg.chat.id, textoVincular(msg.from.id))
      const saldo = await gastosService.saldoDelUsuario({ usuario })
      return reply(msg.chat.id, textoSaldo(usuario, saldo))
    } catch (err) {
      console.error('Error /saldo:', err.message)
      return reply(msg.chat.id, '⚠️ No pude calcular tu saldo.')
    }
  })

  // ─── /categorias ───────────────────────────────────────────
  bot.onText(/^\/categorias(?:@\w+)?\s*$/i, async (msg) => {
    console.log(`[/categorias] from ${msg.from.id}`)
    try {
      const cats = await gastosService.listarCategorias()
      return reply(msg.chat.id, textoCategorias(cats))
    } catch (err) {
      console.error('Error /categorias:', err.message)
      return reply(msg.chat.id, '⚠️ No pude traer las categorías.')
    }
  })

  // ─── Mensaje de texto libre ─────────────────────────────────
  bot.on('message', async (msg) => {
    if (!msg.text || esComando(msg.text)) return
    if (msg.chat.type !== 'private')      return

    const texto = msg.text.trim()
    console.log(`[msg] from ${msg.from.id}: "${texto.substring(0, 60)}"`)

    try {
      const usuario = await usuariosService.buscarPorTelegramId(msg.from.id)
      if (!usuario) return reply(msg.chat.id, textoVincular(msg.from.id))

      // ── ¿Hay una conversación pendiente? ──────────────────────
      if (pendientes.has(msg.chat.id)) {
        const estado = pendientes.get(msg.chat.id)
        const { parsed, fase } = estado

        // --- Fase: esperando monto ---
        if (fase === 'esperando_monto') {
          const nuevoMonto = detectarMonto(texto)
          if (nuevoMonto) {
            parsed.monto = nuevoMonto
            pendientes.set(msg.chat.id, { parsed, usuario, fase: 'revision' })
            return reply(msg.chat.id, textoRevision(parsed))
          }
          return reply(msg.chat.id, `❓ No entendí el monto. Escribilo así: _"59000"_, _"59k"_ o _"59 mil"_`)
        }

        // --- Fase: revisión — esperando sí/no/corrección ---
        const esAfirmativo = /^(s[ií]|ok|dale|correcto|sip|va|si|listo|guardalo|guarda)\b/i.test(texto)
        const esNegativo   = /^(no|cancel|nop|nope|cancela|borr|olvida)\b/i.test(texto)

        if (esAfirmativo) {
          pendientes.delete(msg.chat.id)
          await gastosService.confirmarGasto({ usuario, parsed, canal: 'telegram' })
          return reply(msg.chat.id, mensajeExito(parsed, usuario.nombre))
        }

        if (esNegativo) {
          pendientes.delete(msg.chat.id)
          return reply(msg.chat.id, '❌ Cancelado. Mandame el gasto de nuevo cuando quieras.')
        }

        // ¿Está corrigiendo la categoría?
        const nuevaCat = detectarCategoria(texto)
        if (nuevaCat && nuevaCat !== parsed.categoria) {
          parsed.categoria = nuevaCat
          pendientes.set(msg.chat.id, { parsed, usuario, fase: 'revision' })
          return reply(msg.chat.id,
            `📂 Categoría cambiada a *${nuevaCat}*.\n\n${textoRevision(parsed)}`)
        }

        // ¿Está corrigiendo el monto?
        const nuevoMonto = detectarMonto(texto)
        if (nuevoMonto && nuevoMonto !== parsed.monto) {
          parsed.monto = nuevoMonto
          pendientes.set(msg.chat.id, { parsed, usuario, fase: 'revision' })
          return reply(msg.chat.id,
            `💰 Monto actualizado a *$${nuevoMonto.toLocaleString('es-AR')}*.\n\n${textoRevision(parsed)}`)
        }

        // ¿Está cambiando compartido/personal?
        if (/compartido|entre los dos|juntos|dividimos|pagamos/i.test(texto) && !parsed.es_compartido) {
          parsed.es_compartido = true
          pendientes.set(msg.chat.id, { parsed, usuario, fase: 'revision' })
          return reply(msg.chat.id, `👥 Cambiado a compartido.\n\n${textoRevision(parsed)}`)
        }
        if (/personal|solo yo|s[oó]lo m[ií]o?|mío|solo mio/i.test(texto) && parsed.es_compartido) {
          parsed.es_compartido = false
          pendientes.set(msg.chat.id, { parsed, usuario, fase: 'revision' })
          return reply(msg.chat.id, `👤 Cambiado a personal.\n\n${textoRevision(parsed)}`)
        }

        // No reconocimos la corrección
        return reply(msg.chat.id,
          `❓ No entendí la corrección. Probá con _"es salud"_, _"son 65k"_, _"es compartido"_, _"sí"_ o _"no"_.`)
      }

      // ── Sin pendiente — mensaje nuevo ────────────────────────

      // Saludo
      if (esGaludo(texto)) {
        const hora = new Date().getHours()
        const saludo = hora < 12 ? '¡Buenos días' : hora < 19 ? '¡Buenas tardes' : '¡Buenas noches'
        return reply(msg.chat.id, `${saludo}, *${usuario.nombre}*! 😊 ¿Tenés algún gasto para anotar?`)
      }

      // Parsear como gasto
      const parsed = await parsearMensaje(texto)

      if (!parsed.monto) {
        pendientes.set(msg.chat.id, { parsed, usuario, fase: 'esperando_monto' })
        return reply(msg.chat.id, `❓ *${usuario.nombre}*, no detecté el monto. ¿Cuánto fue?`)
      }

      // Siempre mostrar revisión antes de guardar
      pendientes.set(msg.chat.id, { parsed, usuario, fase: 'revision' })
      return reply(msg.chat.id, textoRevision(parsed))

    } catch (err) {
      console.error('Error procesando mensaje:', err.message)
      return reply(msg.chat.id, '⚠️ Hubo un error procesando tu mensaje.')
    }
  })

  bot.on('polling_error', (err) => {
    console.error('❌ Telegram polling error:', err.code || err.message)
    if (err.code === 'ETELEGRAM') {
      console.error('   Detalle:', JSON.stringify(err.response?.body || {}))
    }
  })

  // ─── Recordatorio diario a las 21:00 (hora Argentina) ──────
  // Avisa a usuarios que no registraron ningún gasto en el día
  cron.schedule('0 21 * * *', () => {
    console.log('🔔 Enviando recordatorios diarios...')
    enviarRecordatorios(bot)
  }, { timezone: 'America/Argentina/Buenos_Aires' })

  console.log('🤖 Bot de Telegram corriendo (polling)')
  console.log('🔔 Recordatorio diario programado para las 21:00 ART')
  return bot
}

module.exports = { iniciarTelegram }
