// Arnés de evaluación del prompt de Ava. Corre escenarios reales contra el modelo real,
// con el catálogo/FAQs/fragmentos vivos de Supabase. NO escribe nada en la base.
//
//   node --experimental-strip-types --import ./scripts/eval-register.mjs scripts/eval-prompt.mts
//
// Acepta filtro y repeticiones: `… eval-prompt.mts 8 5` corre 5 veces los casos que
// empiecen con "8". Las repeticiones importan: a temperatura 0.5 un bug puede no
// aparecer en la primera corrida y seguir vivo en producción.
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

// `prohibido`: patrones que NO deben aparecer. `requerido`: los que SÍ deben aparecer —
// hacen falta para los casos de regresión, donde el riesgo no es que el bot diga de más
// sino que una regla nueva le tape algo que antes hacía bien. El arnés los revisa solo y
// marca ❌, para que un fallo probabilístico no dependa de que alguien lea catorce
// respuestas seguidas con atención.
const casos: {
  nombre: string; historial: never[]; mensaje: string; ciudad: string | null;
  espero: string; prohibido?: RegExp[]; requerido?: RegExp[];
}[] = [
  { nombre: "1. Yesa — pide ubicación en primer contacto", historial: [] as never[],
    mensaje: "ubicación", ciudad: null as string | null,
    espero: "Debe NOMBRAR las dos sucursales y pedir la ciudad. NO un saludo seco." },
  { nombre: "2. Fuga de precio — mensaje del catálogo de WhatsApp", historial: [] as never[],
    mensaje: "¿Me podrían dar más información del Lambrin?", ciudad: null as string | null,
    espero: "SIN cifra ($1,330 / $95). Debe pedir la ciudad.",
    prohibido: [/1[,.]?330/, /\$\s?95\b/] },
  { nombre: "2b. Precio directo sin ciudad", historial: [] as never[],
    mensaje: "cuanto cuesta el lambrin?", ciudad: null as string | null,
    espero: "SIN cifra. Solo la pregunta de la ciudad.",
    prohibido: [/1[,.]?330/, /\$\s?95\b/] },
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
    espero: "NO debe cotizar flete ni pallet. Debe remitirlo a Guadalupe.",
    prohibido: [/4[,.]?413/, /1[,.]?190/, /\$\s?85\b/] },
  { nombre: "4c. Luis — 25 m² (el 15-ago calculó 46 piezas; son 65)",
    historial: [] as never[], mensaje: "Quiero cubrir 25 mts cuadrados de lambrin", ciudad: "Saltillo" as string | null,
    espero: "65 piezas → 5 cajas (70 pzs), sobran 5. NUNCA 4 cajas." },
  { nombre: "4d. Oscar — 39 m² (el 09-jul dijo 7 cajas; son 8)",
    historial: [] as never[], mensaje: "son 39 m2, cuantas cajas de lambrin ocupo?", ciudad: "Saltillo" as string | null,
    espero: "100 piezas → 8 cajas (112 pzs), sobran 12. NUNCA 7 cajas." },
  { nombre: "5b. REGRESIÓN — cliente foráneo SÍ debe cotizarse",
    historial: [] as never[], mensaje: "me envian a Guadalajara?", ciudad: "Guadalajara" as string | null,
    espero: "Precotización completa: $1,190/caja, flete con IVA, total, costo por pieza, llenar pallet, leyenda.",
    requerido: [/1[,.]?190/, /4[,.]?413/, /precotizaci/i] },
  { nombre: "5c. REGRESIÓN — local pide entrega a domicilio",
    historial: [] as never[], mensaje: "me lo pueden llevar a mi casa? no tengo camioneta", ciudad: "Saltillo" as string | null,
    espero: "Sin flete inventado. Fletera externa + pedir datos + representative.",
    prohibido: [/1[,.]?190/, /\$\s?85\b/, /4[,.]?413/] },
  { nombre: "6. Wall cladding agotado", historial: [] as never[],
    mensaje: "Manejas wall cladding para exterior?", ciudad: "Saltillo" as string | null,
    espero: "Agotado + SÍ vuelve SIN fecha. Nada de 'muy pronto' ni 'te avisamos'." },
  { nombre: "7. Mármol PVC", historial: [] as never[],
    mensaje: "Manejas placa tipo mármol pvc? de qué medida es?", ciudad: "Saltillo" as string | null,
    espero: "$550 por hoja, sin fotos, invitar a visitar. PROHIBIDO inventar medidas." },
  // Silvia Esparza, 19-ago 17:14. Es de Saltillo, ya recibió el precio de mostrador,
  // y aun así el bot le cotizó el material al precio ③ ($85/$1,190) con un "flete a
  // Saltillo: $0" inventado, rematando con "pasa por la tienda, mismo precio". Le
  // ofreció recoger en mostrador al precio de envío: $140 menos por caja.
  { nombre: "8. Silvia — local ACEPTA el envío (fuga del precio ③)",
    historial: [m("user","¿Me podrían dar más información del Lambrin?"),
                m("bot","Es machihembrado, caja de 14 piezas 🌿 ¿Desde qué ciudad nos escribes?"),
                m("user","Tienes envío a domicilio"),
                m("bot","¡Sí, enviamos a todo México! 🚚 ¿De qué ciudad nos escribes?"),
                m("user","Saltillo\nDel fraccionamiento Gustavo Díaz Ordaz"),
                m("bot","¡Perfecto, estás cerquita! 😊 Blvd. Vito Alessio Robles 3550, Local 9. El lambrín está en $95 la pieza ($1,330 la caja).")],
    mensaje: "Me gustaría envío", ciudad: "Saltillo" as string | null,
    espero: "PROHIBIDO $85/$1,190 y PROHIBIDO 'flete $0/gratis'. Mantener $1,330 y mandarla a fletera externa.",
    // El síntoma que llega primero no es la cifra sino la PROMESA: el 19-ago el bot
    // ofreció cotizarle el envío y hasta el turno siguiente soltó el $85.
    prohibido: [/1[,.]?190/, /\$\s?85\b/, /flete[^.]{0,20}\$?\s?0\b/i, /flete[^.]{0,25}(gratis|sin costo)/i, /4[,.]?413/,
                /te cotizo/i, /cotizarte/i, /cotizo el env/i] },
  // La causa del caso 8: dos turnos antes, sin saber su ciudad, el bot cerró con
  // "o si prefieres que te lo mandemos, con gusto te cotizo todo" — la frase que
  // ai.ts:583 prohíbe. Cuando ella dijo "me gustaría envío" estaba aceptando esa oferta.
  { nombre: "8b. Silvia — oferta de envío ANTES de saber la ciudad",
    historial: [m("user","¿Me podrían dar más información del Lambrin?"),
                m("bot","Es machihembrado, caja de 14 piezas 🌿 ¿Desde qué ciudad nos escribes?")],
    mensaje: "Tienes envío a domicilio", ciudad: null as string | null,
    espero: "Sí enviamos a todo México + pedir ciudad. PROHIBIDO prometer cotización ('con gusto te cotizo').",
    prohibido: [/te cotizo/i, /cotizarte/i, /si prefieres que te lo mandemos/i] },
];

// Filtro opcional: `… scripts/eval-prompt.mts 8` corre solo los casos cuyo nombre
// empiece con "8". Sin argumento corre todos. Iterar sobre un caso suelto mientras se
// ajusta el prompt cuesta centavos en vez de la corrida completa.
const filtro = process.argv[2];
const vueltas = Number(process.argv[3] ?? 1);
const aCorrer = filtro ? casos.filter((c) => c.nombre.startsWith(filtro)) : casos;
if (!aCorrer.length) { console.error(`Ningún caso empieza con "${filtro}".`); process.exit(1); }

let fallos = 0;
for (const c of aCorrer) {
  console.log("━".repeat(78));
  console.log(`▶ ${c.nombre}`);
  console.log(`  ciudad en contexto: ${c.ciudad ?? "(ninguna)"} | cliente dice: "${c.mensaje}"`);
  console.log(`  esperado: ${c.espero}`);
  for (let i = 1; i <= vueltas; i++) {
    const r = await generateResponse(
      c.mensaje, products as never, faqs as never, c.historial, "Cliente",
      settings as Record<string, string>, fragments as never, undefined, undefined, c.ciudad,
    );
    // Cuando todos los proveedores fallan (llave sin saldo, timeout), generateResponse
    // devuelve el mensaje de disculpa. Sin esta guarda eso PASA en falso: un texto de
    // error no contiene nada prohibido. Se aborta, porque la corrida ya no mide nada.
    if (/tuve un problema técnico/i.test(r.message)) {
      console.error(`\n  ⛔ El modelo no respondió (fallaron todos los proveedores).` +
                    ` La corrida no es válida — revisa AI_GATEWAY_API_KEY y su saldo.`);
      process.exit(2);
    }
    const violados = (c.prohibido ?? []).filter((re) => re.test(r.message));
    const faltantes = (c.requerido ?? []).filter((re) => !re.test(r.message));
    const mal = violados.length + faltantes.length;
    if (mal) fallos++;
    const marca = !c.prohibido && !c.requerido ? "•" : mal ? "❌" : "✅";
    const detalle = [
      violados.length ? `PROHIBIDO: ${violados.map(String).join(" ")}` : "",
      faltantes.length ? `FALTA: ${faltantes.map(String).join(" ")}` : "",
    ].filter(Boolean).join(" · ");
    console.log(`\n  ${marca} corrida ${i}/${vueltas}${detalle ? ` — ${detalle}` : ""}`);
    console.log(`  🤖 ${r.message.replace(/\n/g, "\n     ")}`);
    console.log(`  [intent=${r.intent} · customer_city=${JSON.stringify(r.customer_city)}]`);
  }
  console.log();
}
console.log("━".repeat(78));
console.log(fallos ? `❌ ${fallos} respuesta(s) fuera de lo esperado.` : "✅ Todas las respuestas verificadas pasaron.");
if (fallos) process.exitCode = 1;
