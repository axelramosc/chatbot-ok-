# WhatsApp Sales Bot 🤖

Chatbot de ventas para WhatsApp con IA (Groq) que responde consultas sobre lambrín y wall cladding coextruido.

## Stack

- **Framework:** Next.js 15 (App Router)
- **IA:** Groq API (llama-3.3-70b-versatile) — ~85ms response time
- **Database:** Supabase (PostgreSQL)
- **WhatsApp:** Meta Cloud API v20.0
- **Deploy:** Vercel

## Features

- ✅ Respuestas naturales con IA sobre productos
- ✅ Catálogo de productos dinámico (Supabase)
- ✅ Preguntas frecuentes automáticas
- ✅ Historial de conversaciones
- ✅ Detección de intención de compra
- ✅ Notificación automática al admin cuando hay venta potencial
- ✅ Deduplicación de mensajes
- ✅ Verificación de firma de seguridad

## Setup

### 1. Clonar repositorio

```bash
git clone https://github.com/YOUR_USER/whatsapp-sales-bot.git
cd whatsapp-sales-bot
npm install
```

### 2. Configurar variables de entorno

Copiar `.env.example` a `.env.local` y llenar:

```bash
cp .env.example .env.local
```

### 3. Variables necesarias

| Variable | Descripción |
|:---|:---|
| `WHATSAPP_ACCESS_TOKEN` | System User Access Token de Meta |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone Number ID de WhatsApp Business |
| `WHATSAPP_VERIFY_TOKEN` | Token personalizado para verificar webhook |
| `WHATSAPP_APP_SECRET` | App Secret de Meta (para verificar firmas) |
| `GROQ_API_KEY` | API Key de Groq (console.groq.com) |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service Role Key de Supabase |
| `ADMIN_WHATSAPP_NUMBER` | Número del admin para notificaciones |

### 4. Desarrollo local

```bash
npm run dev
# En otra terminal:
ngrok http 3000
```

Configurar la URL de ngrok como webhook en Meta Developer Dashboard:
`https://YOUR_NGROK_URL/api/webhook`

### 5. Deploy a Vercel

```bash
vercel --prod
```

O conectar el repositorio de GitHub a Vercel para deploy automático.

## Webhook URL

```
https://YOUR_DOMAIN/api/webhook
```

## Arquitectura

```
WhatsApp → Meta Cloud API → Webhook (Vercel) → Groq AI → WhatsApp
                                    ↓
                              Supabase (DB)
                                    ↓
                          Admin Notification
```

## Licencia

MIT
 
