# Guía del DM: primeros pasos

Una vez instalado (ver [guía de instalación](guia-instalacion.md)), abre el enlace de tu mesa. La primera vez, Lantern muestra una guía de bienvenida de varios pasos que puedes repetir cuando quieras.

## 1. Crear la mesa e invitar

- Si usaste el asistente, tu primera mesa ya existe. Para otras, créalas desde el vestíbulo con tu nombre y un título.
- Cada mesa tiene un **código** de 6 caracteres. Pulsa el código de la barra superior y compártelo (o comparte el enlace/QR).
- Hay una **antesala de sesión** para reunir a los jugadores antes de empezar.
- Puedes importar una campaña de Lantern (`.zip`/JSON) desde el vestíbulo, o exportar la tuya como copia de seguridad: [formato](../apps/server/FORMAT.md).

## 2. Subir un mapa

- Pestaña **Biblioteca**: tus escenas, importar mapas y organizarlas en carpetas.
- Sube una imagen (hasta 30 MB) o importa un `.dd2vtt`/`.uvtt` de Dungeondraft: traen cuadrícula, muros y luces ya puestos.
- Cambia de escena cuando quieras (**Cambiar de escena**); al importar, Lantern te ofrece activarla.

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

## 5. Fichas y monstruos

- Pestaña **Encuentros**: busca monstruos del SRD y arrástralos al mapa, o «Añadir al combate». Cantidad y agrupar iniciativa incluidos.
- Los jugadores traen sus personajes con el creador integrado, una hoja pregenerada, o desde D&D Beyond con [Lantern Link](lantern-link.md).
- Como DM puedes ver/editar todas las fichas; las estadísticas de un monstruo pueden ocultarse a los jugadores.

## 6. Combate

- Inicia el combate con los tokens del encuentro: tira iniciativa, y el orden de turnos se muestra a todos.
- Ataca y aplica daño en pocos clics: elige la ficha, la acción y el objetivo; Lantern tira, compara con la CA/salvación, aplica el daño por tipo (resistencias incluidas) y las condiciones.
- Reacciones (`Alt+R`), acciones legendarias, recursos por descanso y turnos de monstruo con el **copiloto** (si lo activaste): propone opciones legales y tú confirmas.

## 7. Modo Historia, clima y música

- Pestaña **Escena**:
  - **Clima** por zona (lluvia, ceniza, brasas, corrientes de agua…); «Despejado» crea una zona sin clima.
  - **Modo Historia**: capítulos y transiciones a pantalla completa con texto («Clic o Espacio para continuar»).
  - **Música y ambiente**: biblioteca de audio incluida (CC0) más tus archivos; capas de ambiente y en bucle. Los jugadores oyen lo que activas.
- El **diario** y el chat de la mesa guardan tus notas y tiradas. Voz integrada por WebRTC (para mesas grandes, LiveKit: [autoalojamiento](autoalojamiento.md)).

## 8. Antes de la próxima sesión

Exporta la campaña como copia de seguridad. Lantern también guarda copias automáticas periódicas en la carpeta `backups/` junto a los datos.
