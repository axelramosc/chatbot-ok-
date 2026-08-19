// Resolver mínimo para el PoC: Next resuelve imports sin extensión, Node no.
export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !/\.(ts|tsx|mts|js|mjs|json)$/.test(specifier)) {
    try { return await next(specifier + ".ts", context); } catch {}
  }
  return next(specifier, context);
}
