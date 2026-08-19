// Next resuelve imports sin extensión; Node no. Este hook cierra esa diferencia
// para poder correr el arnés de evaluación sin un bundler.
import { register } from "node:module";
register("./eval-loader.mjs", import.meta.url);
