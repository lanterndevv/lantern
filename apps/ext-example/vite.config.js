// El iframe de la extensión va en sandbox sin allow-same-origin (origen opaco «null»):
// los <script type="module"> se piden con CORS, así que el servidor de la extensión debe enviar Access-Control-Allow-Origin.
export default { server: { cors: { origin: '*' } }, preview: { cors: { origin: '*' } } };
