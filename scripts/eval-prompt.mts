// Arnés de evaluación del prompt de Ava. Corre escenarios reales contra el modelo real,
// con el catálogo/FAQs/fragmentos vivos de Supabase. NO escribe nada en la base.
//
//   node --experimental-strip-types --import ./scripts/eval-register.mjs scripts/eval-prompt.mts
//
// Cada caso trae el escenario que lo originó y lo que se espera ver. Cuando el equipo
// reporte una incongruencia, agrégala aquí antes de tocar el prompt: así se comprueba
// que quedó arreglada sin esperar a que un cliente real lo confirme.
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const mm = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (mm) process.env[mm[1]] ??= mm[2].trim().replace(/^["']|["']$/g, "");
}

const { generateResponse } = await import("../lib/ai.ts");
const db = await import("../lib/database.ts");

const [products, faqs, settings, fragments] = await Promise.all([
  db.getActiveProducts(), db.getActiveFAQs(), db.getBusinessSettings(), db.getKnowledgeFragments(),
]);
console.log(`📦 ${products.length} productos · ${faqs.length} FAQs · ${fragments.length} fragmentos\n`);

const m = (sender: "user" | "bot", content: string) => ({ sender, content }) as never;

const casos = [
  { nombre: "1. Yesa — pide ubicación en primer contacto", historial: [] as never[],
    mensaje: "ubicación", ciudad: null as string | null,
    espero: "Debe NOMBRAR las dos sucursales y pedir la ciudad. NO un saludo seco." },
  { nombre: "2. Fuga de precio — mensaje del catálogo de WhatsApp", historial: [] as never[],
    mensaje: "¿Me podrían dar más información del Lambrin?", ciudad: null as string | null,
    espero: "SIN cifra ($1,330 / $95). Debe pedir la ciudad." },
  { nombre: "2b. Precio directo sin ciudad", historial: [] as never[],
    mensaje: "cuanto cuesta el lambrin?", ciudad: null as string | null,
    espero: "SIN cifra. Solo la pregunta de la ciudad." },
  { nombre: "3. Ana — ciudad dicha hace 14 mensajes (memoria persistida)",
    historial: [m("user","Me pasa catalogo"), m("bot","Tenemos lambrín en 5 colores 🌿"),
                m("user","Quiero verlos en imagen"), m("bot","Aquí te mando fotos 📸"),
                m("user","Me muestras color nogal"), m("bot","Aquí está el Nogal Oscuro"),
                m("user","Otro"), m("bot","Aquí el Nogal Claro"),
                m("user","Muchas gracias ya se cual quiero"), m("bot","¿Cuál elegiste y cuántas cajas?")],
    mensaje: "1 caja", ciudad: "Saltillo" as string | null,
    espero: "NO debe volver a preguntar la ciudad. Debe dar $1,330." },
  { nombre: "4b. JR — cálculo con sobrante chico",
    historial: [] as never[], mensaje: "Quiero forrar 9 m2 de un porton por dentro, cuanto material ocupo?",
    ciudad: "Saltillo" as string | null,
    espero: "24 piezas → 2 cajas, sobran 4 = holgura. Nada de una 3a caja." },
  { nombre: "4. Paulina — cálculo de material (caja cerrada)",
    historial: [m("user","¿Me podrían dar más información del Lambrin?"), m("bot","Es machihembrado, caja de 14 piezas 🌿 ¿Desde qué ciudad nos escribes?"),
                m("user","De aquí de Saltillo"), m("bot","¡Perfecto! $95 la pieza, $1,330 la caja.")],
    mensaje: "Son como 6 mts2", ciudad: "Saltillo" as string | null,
    espero: "1 caja. PROHIBIDO 'pieza extra'. Debe explicar caja cerrada y piezas sobrantes." },
  { nombre: "5. the joe — cliente de Monterrey pregunta por envíos",
    historial: [m("user","¿Dónde se ubican?"), m("bot","Tenemos dos sucursales, ¿desde qué ciudad?"),
                m("user","Mty"), m("bot","¡Perfecto! Estamos en Guadalupe, N.L. 📍 Frankfurt #2A")],
    mensaje: "Tienes envios", ciudad: "Monterrey" as string | null,
    espero: "NO debe cotizar flete ni pallet. Debe remitirlo a Guadalupe." },
  { nombre: "4c. Luis — 25 m² (el 15-ago calculó 46 piezas; son 65)",
    historial: [] as never[], mensaje: "Quiero cubrir 25 mts cuadrados de lambrin", ciudad: "Saltillo" as string | null,
    espero: "65 piezas → 5 cajas (70 pzs), sobran 5. NUNCA 4 cajas." },
  { nombre: "4d. Oscar — 39 m² (el 09-jul dijo 7 cajas; son 8)",
    historial: [] as never[], mensaje: "son 39 m2, cuantas cajas de lambrin ocupo?", ciudad: "Saltillo" as string | null,
    espero: "100 piezas → 8 cajas (112 pzs), sobran 12. NUNCA 7 cajas." },
  { nombre: "5b. REGRESIÓN — cliente foráneo SÍ debe cotizarse",
    historial: [] as never[], mensaje: "me envian a Guadalajara?", ciudad: "Guadalajara" as string | null,
    espero: "Precotización completa: $1,190/caja, flete con IVA, total, costo por pieza, llenar pallet, leyenda." },
  { nombre: "5c. REGRESIÓN — local pide entrega a domicilio",
    historial: [] as never[], mensaje: "me lo pueden llevar a mi casa? no tengo camioneta", ciudad: "Saltillo" as string | null,
    espero: "Sin flete inventado. Fletera externa + pedir datos + representative." },
  { nombre: "6. Wall cladding agotado", historial: [] as never[],
    mensaje: "Manejas wall cladding para exterior?", ciudad: "Saltillo" as string | null,
    espero: "Agotado + SÍ vuelve SIN fecha. Nada de 'muy pronto' ni 'te avisamos'." },
  { nombre: "7. Mármol PVC", historial: [] as never[],
    mensaje: "Manejas placa tipo mármol pvc? de qué medida es?", ciudad: "Saltillo" as string | null,
    espero: "$500 por hoja, sin fotos, invitar a visitar. PROHIBIDO inventar medidas." },
];

for (const c of casos) {
  const r = await generateResponse(
    c.mensaje, products as never, faqs as never, c.historial, "Cliente",
    settings as Record<string, string>, fragments as never, undefined, undefined, c.ciudad,
  );
  console.log("━".repeat(78));
  console.log(`▶ ${c.nombre}`);
  console.log(`  ciudad en contexto: ${c.ciudad ?? "(ninguna)"} | cliente dice: "${c.mensaje}"`);
  console.log(`  esperado: ${c.espero}`);
  console.log(`\n  🤖 ${r.message.replace(/\n/g, "\n     ")}`);
  console.log(`\n  [intent=${r.intent} · customer_city=${JSON.stringify(r.customer_city)}]\n`);
}
