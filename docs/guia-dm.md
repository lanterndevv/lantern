# Guía del DM: primeros pasos

Una vez instalado (ver [guía de instalación](guia-instalacion.md)), abre el enlace de tu mesa. La primera vez, Lantern muestra una guía de bienvenida de varios pasos (los jugadores tienen la suya). Para repetirla, abre la paleta con `Ctrl+K` y elige **Repetir la guía**.

## 1. Crear la mesa e invitar

- Si usaste el asistente, tu primera mesa ya existe. Para otras, créalas desde el vestíbulo con tu nombre y un título.
- Cada mesa tiene un **código** de 6 caracteres. Pulsa el código de la barra superior y compártelo (o comparte el enlace/QR).
- Hay una **antesala de sesión** para reunir a los jugadores antes de empezar.
- Puedes importar una campaña de Lantern (`.zip`/JSON) desde el vestíbulo, o exportar la tuya como copia de seguridad: [formato](../apps/server/FORMAT.md).

## 2. Subir un mapa

- Pestaña **Biblioteca**: tus escenas, importar mapas y organizarlas en carpetas.
- Sube una imagen (hasta 30 MB) o importa un `.dd2vtt`/`.uvtt` de Dungeondraft: traen cuadrícula, muros y luces ya puestos.
- Cada escena muestra una miniatura de su mapa. Al crear o importar una, Lantern te ofrece abrirla.
- **Activar** cambia a todos de escena. Si hay un combate en curso, Lantern pide confirmación: cambiar de escena lo termina y descarta las tiradas pendientes.
- **Preparar** hace que los jugadores descarguen el mapa antes de activarlo; la escena muestra «Precargada en a/b» a medida que lo tienen listo.

## 3. Calibrar la cuadrícula

Si el mapa es una imagen sin datos, usa la herramienta **Calibrar cuadrícula**:

1. Ajusta el tamaño de casilla hasta que las líneas coincidan con las del mapa (**Casilla más grande/pequeña**).
2. Ajuste fino con las flechas y `+`/`−` (Mayús = más). Desplaza la cuadrícula arriba/abajo/izquierda/derecha.
3. La regla mide en pies: al mover una ficha, ves la distancia.

## 4. Muros, puertas y luces

Esto es lo que da la niebla y la visión dinámicas:

- Dibuja **muros** con las herramientas de edición. Hay tipos (invisibles, etéreos, de un solo sentido) y **puertas** que se abren con la tecla `E`, con llave (CD de la cerradura) o secretas.
- **Detectar muros (beta)** propone muros a partir de la imagen: revisa y pulsa «Aceptar n muros».
- Coloca **luces** (antorcha, brasas…). Cada ficha ve según sus sentidos (oscuridad, visión en la oscuridad, invisibilidad, etc.) y los jugadores solo ven lo que sus personajes pueden ver.
- También hay escaleras/teleports entre escenas, y elevación por ficha.
- Con la herramienta **Seleccionar** (`V`), el inspector edita el elemento elegido. Si tiene cambios sin guardar, lo indica y pide confirmación antes de descartarlos.
- Desde el móvil o una tablet puedes seleccionar y corregir puertas, luces, regiones y fichas (el inspector sale abajo); dibujar muros, luces o regiones es solo de escritorio.

## 5. Fichas y monstruos

- Pestaña **Encuentros**: añade monstruos del SRD, mira la dificultad para el grupo y pulsa **Colocar en el mapa** (luego un clic donde quieras el grupo). La lista se conserva para repetirla; **Vaciar** empieza otra.
- **Guardar** deja el encuentro en la campaña (viaja con la exportación) para cargarlo en otra sesión.
- El **Compendio** trae los monstruos con su bloque de estadísticas y los conjuros con su descripción oficial del SRD (en inglés); la búsqueda también mira dentro del texto.
- Los jugadores traen sus personajes con el **creador rápido** (especie, clase, nivel, equipo, conjuros y Ataque extra; subclase y dotes se completan a mano), una hoja pregenerada, o desde D&D Beyond con [Lantern Link](lantern-link.md).
- Como DM puedes ver/editar todas las fichas; las estadísticas de un monstruo pueden ocultarse a los jugadores.

## 6. Combate

- Inicia el combate con los tokens del encuentro: tira iniciativa, y el orden de turnos se muestra a todos.
- Ataca y aplica daño en pocos clics: elige la ficha, la acción y el objetivo; Lantern tira, compara con la CA/salvación, aplica el daño por tipo (resistencias incluidas) y las condiciones.
- Al empezar un turno, el panel de acciones cambia a la ficha activa. Un conjuro con varios niveles de espacio libres deja elegir el nivel antes del objetivo, y el daño o la curación escala.
- **Ayudar contra…** (menú de la ficha) da ventaja al siguiente ataque de un aliado contra ese enemigo. La regla de movimiento aplica apresado, restringido, agotamiento y mapas hexagonales.
- Reacciones (`Alt+R`), acciones legendarias, recursos por descanso y turnos de monstruo con el **copiloto** (si lo activaste): propone opciones legales y tú confirmas.

## 7. Modo Historia, clima y música

- Pestaña **Escena**:
  - **Clima** por zona (lluvia, ceniza, brasas, corrientes de agua…); «Despejado» crea una zona sin clima.
  - **Modo Historia**: capítulos y transiciones a pantalla completa con texto. En los diálogos de PNJ, el primer clic (o Espacio) muestra el texto entero y el segundo lo cierra.
  - **Música y ambiente**: biblioteca de audio incluida (CC0) más tus archivos; capas de ambiente y en bucle. Los jugadores oyen lo que activas.
- El **diario** y el chat de la mesa guardan tus notas y tiradas. Las entradas nuevas son «Solo DM»: al pulsar **Mostrar a jugadores**, Lantern pregunta si hacerla visible.
- Voz integrada por WebRTC (para mesas grandes, LiveKit: [autoalojamiento](autoalojamiento.md)). En modo «Pulsar para hablar» hay un botón que se mantiene pulsado, para móviles.
- Pestaña **Herramientas**: «Durante la sesión» (ver como jugador, descansos, botín, PDF, marcadores) y «Administrar campaña» (copias y fusión).

## Seguridad en la mesa

- **Líneas y velos** se acuerdan en la antesala, de forma anónima, y se consultan durante la partida con el botón `≡` junto a la X.
- **Tarjeta X** (botón X o `Alt+X`): pausa la mesa para todos sin decir quién la usó. El DM la levanta con **Reanudar para todos**.

## 8. Antes de la próxima sesión

Exporta la campaña como copia de seguridad. Lantern también guarda copias automáticas periódicas en la carpeta `backups/` junto a los datos, pero **sin imágenes ni audios**: esos siguen en la carpeta de recursos (`LANTERN_ASSETS`). Para una copia completa, exporta la campaña o copia también esa carpeta.
