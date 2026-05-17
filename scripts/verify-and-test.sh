#!/bin/bash
# ============================================================
# DecoBot - Verificación de número y prueba E2E
# ============================================================
# Uso:
#   ./scripts/verify-and-test.sh          → Envía código SMS
#   ./scripts/verify-and-test.sh 123456   → Verifica con código
#   ./scripts/verify-and-test.sh test     → Prueba E2E completa
# ============================================================

set -e

# Load env
if [ -f .env.local ]; then
  export $(grep -v '^#' .env.local | xargs)
fi

PHONE_ID="$WHATSAPP_PHONE_NUMBER_ID"
TOKEN="$WHATSAPP_ACCESS_TOKEN"
GRAPH="https://graph.facebook.com/v25.0"

echo ""
echo "🤖 DecoBot - Panel de Verificación"
echo "===================================="

# Step 1: Check status
STATUS=$(curl -s "${GRAPH}/${PHONE_ID}?fields=code_verification_status,display_phone_number,verified_name&access_token=${TOKEN}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('code_verification_status','ERROR'))")
PHONE=$(curl -s "${GRAPH}/${PHONE_ID}?fields=display_phone_number&access_token=${TOKEN}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('display_phone_number','?'))")

echo "📱 Número: $PHONE"
echo "📋 Estado: $STATUS"
echo ""

# If code is provided → verify
if [ -n "$1" ] && [[ "$1" =~ ^[0-9]{6}$ ]]; then
  echo "🔐 Verificando con código: $1"
  RESULT=$(curl -s -X POST "${GRAPH}/${PHONE_ID}/verify_code" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"code\": \"$1\"}")
  echo "$RESULT" | python3 -m json.tool
  echo ""
  echo "✅ Si ves success=true, ¡el número está verificado!"
  echo "   Corre: ./scripts/verify-and-test.sh test"
  exit 0
fi

# If test → run E2E
if [ "$1" = "test" ]; then
  echo "🧪 Corriendo prueba E2E..."
  RESULT=$(curl -s -X POST "${GRAPH}/${PHONE_ID}/messages" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
      \"messaging_product\": \"whatsapp\",
      \"to\": \"${ADMIN_WHATSAPP_NUMBER}\",
      \"type\": \"text\",
      \"text\": { \"body\": \"✅ ¡DecoBot está en línea! El sistema de ventas de Greenland Deco está listo.\" }
    }")
  echo "$RESULT" | python3 -m json.tool
  exit 0
fi

# Default: request SMS code
if [ "$STATUS" = "VERIFIED" ]; then
  echo "🎉 ¡El número ya está verificado! Corre:"
  echo "   ./scripts/verify-and-test.sh test"
  exit 0
fi

echo "📤 Enviando código SMS a $PHONE..."
RESULT=$(curl -s -X POST "${GRAPH}/${PHONE_ID}/request_code" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"code_method": "SMS", "language": "es"}')

# Check for rate limit error
if echo "$RESULT" | grep -q "136024"; then
  WAIT=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['error']['error_user_msg'])" 2>/dev/null)
  echo "⏳ Rate limit activo: $WAIT"
  echo ""
  echo "Vuelve a intentar después de que pase el tiempo indicado."
  exit 1
fi

if echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('success') else 1)" 2>/dev/null; then
  echo ""
  echo "✅ Código enviado por SMS. Revisa tu teléfono (+52 844 281 4094)."
  echo ""
  echo "Cuando tengas el código de 6 dígitos, corre:"
  echo "   ./scripts/verify-and-test.sh XXXXXX"
else
  echo "Respuesta de Meta:"
  echo "$RESULT" | python3 -m json.tool
fi
