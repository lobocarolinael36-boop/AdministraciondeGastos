# 🏠 CasaFlow

Gestor de gastos compartidos con IA y **Telegram**.
Cargás tus gastos por chat, la IA los entiende, todo queda organizado.

---

## Setup rápido

### 1. Instalar

```bash
npm install
```

### 2. Crear el bot de Telegram

1. Abrí Telegram y hablá con [@BotFather](https://t.me/BotFather).
2. Mandá `/newbot` y seguí los pasos (nombre + username terminado en `bot`).
3. Copiá el **token** que te entrega.

### 3. Configurar `.env`

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=tu-pass
DB_NAME=casaflow
PORT=3000

OPENAI_API_KEY=sk-...           # opcional (si no, modo mock)
OPENAI_MODEL=gpt-4o-mini

TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=123456:ABC...  # ← el token de BotFather
```

### 4. Crear la base de datos

```bash
mysql -u root -p < sql/schema.sql
mysql -u root -p < sql/migrations/001_add_telegram_id.sql
```

> Si ya tenías la DB creada de la versión anterior, corré solo la migración `001`.

### 5. Levantar el servidor

```bash
npm run dev   # con recarga automática
# o
npm start
```

Verás en consola:

```
🏠 CasaFlow corriendo en http://localhost:3000
🤖 Bot de Telegram corriendo (polling)
```

---

## Usar el bot

### Primer uso (vinculación)

1. En Telegram, buscá tu bot por su `@username` y mandale `/start`.
2. Si tu Telegram no está vinculado, te va a pedir tu teléfono:

   ```
   /vincular 5491100000001
   ```

   El teléfono ya tiene que existir en `usuarios` (lo carga el admin con el seed o por API).

3. Listo. Te confirma con tu nombre y hogar.

### Comandos

| Comando | Qué hace |
|---|---|
| `/start` | Saluda / pide vinculación |
| `/help` | Ayuda |
| `/resumen` | Total del mes (por categoría y por persona) |
| `/saldo` | Cuánto gastaste vos este mes |
| `/categorias` | Categorías disponibles |
| `/vincular <tel>` | Vincula tu Telegram a un usuario existente |

### Cargar un gasto (mensaje natural)

```
14 lucas de luz
gasté 18500 en el super
ayer pagamos 80mil de alquiler entre los dos
```

El bot te responde:

```
✅ Carolina, registré:
💰 $14.000 — 14 lucas de luz
📂 Luz
```

---

## Endpoints HTTP (siguen disponibles)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/gastos/mensaje` | Carga gasto desde texto natural — body: `{ telegram_id \| telefono, mensaje }` |
| POST | `/api/gastos` | Carga directa (sin IA) |
| GET  | `/api/gastos` | Lista gastos del mes |
| GET  | `/api/gastos/resumen` | Resumen por categoría y usuario |
| DELETE | `/api/gastos/:id` | Elimina un gasto |
| GET  | `/api/usuarios` | Lista usuarios |
| POST | `/api/usuarios` | Crea usuario (acepta `telegram_id` opcional) |
| GET  | `/api/usuarios/telegram/:id` | Busca por telegram_id |
| GET  | `/api/usuarios/telefono/:tel` | Busca por teléfono |
| PATCH | `/api/usuarios/:id/telegram` | Vincula telegram_id a un usuario |
| GET  | `/api/categorias` | Lista categorías |
| GET  | `/api/categorias/presupuestos` | Presupuestos del mes |
| PUT  | `/api/categorias/presupuestos` | Crea/actualiza presupuesto |
| GET  | `/health` | Health check |
| POST | `/api/test/parsear` | Prueba el parser de IA |

---

## Estructura

```
casaflow/
├── sql/
│   ├── schema.sql                          ← schema base
│   └── migrations/
│       └── 001_add_telegram_id.sql         ← migración Telegram
├── src/
│   ├── index.js                            ← Express + arranque del bot
│   ├── db/pool.js                          ← MySQL
│   ├── ai/parser.js                        ← Parser NLP (OpenAI / mock)
│   ├── services/                           ← CAPA DE LÓGICA (reusable)
│   │   ├── gastos.service.js
│   │   └── usuarios.service.js
│   ├── telegram/                           ← CAPA DE TRANSPORTE
│   │   └── bot.js
│   └── routes/                             ← REST API (Mini App / web futura)
│       ├── gastos.js
│       ├── usuarios.js
│       └── categorias.js
└── package.json
```

> **Por qué esta separación:** el día de mañana, una Telegram Mini App o una web mobile-first
> consume `src/services/*` o los endpoints `/api/*` y reutiliza el mismo parser y la misma lógica
> sin tocar el bot.

---

## Pivot a Mini App / Web (cuando quieras)

- La capa `services/` ya es independiente del transporte.
- La REST API ya soporta `telegram_id`, así que una Mini App con `Telegram.WebApp.initData` puede autenticar al usuario y pegarle a los mismos endpoints.
- No hace falta tocar el parser ni el SQL.
