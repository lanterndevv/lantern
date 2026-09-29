# Guía de instalación (sin conocimientos técnicos)

Esta guía te lleva de cero a tener una mesa de Lantern con un enlace para tus jugadores. Tarda unos 5 minutos.

Vas a hacer una sola cosa técnica: pegar **un comando** en una terminal. El resto lo hace un asistente que te pregunta con lenguaje normal.

## 1. Abre una terminal

- **Windows:** pulsa la tecla Windows, escribe `PowerShell` y abre «Windows PowerShell» (no hace falta «como administrador»).
- **macOS:** pulsa `Cmd + Espacio`, escribe `Terminal` y pulsa Intro.
- **Linux:** busca «Terminal» en tu menú de aplicaciones (o `Ctrl + Alt + T`).

## 2. Pega el comando

**Windows**

```powershell
irm https://raw.githubusercontent.com/lanterndevv/lantern/master/install.ps1 | iex
```

**macOS y Linux**

```sh
curl -fsSL https://raw.githubusercontent.com/lanterndevv/lantern/master/install.sh | sh
```

Para pegar: en Windows, clic derecho dentro de PowerShell (o `Ctrl + V`); en macOS, `Cmd + V`; en Linux, `Ctrl + Mayús + V`. Pulsa Intro.

El script descarga el asistente, comprueba que el archivo no está dañado ni manipulado (SHA-256) y lo abre. Si la comprobación falla, no instala nada.

> Si prefieres no ejecutar un script a ciegas, puedes leerlo antes: [install.sh](../install.sh) e [install.ps1](../install.ps1), o descargar el asistente a mano desde la [página de releases](https://github.com/lanterndevv/lantern/releases).

## 3. Responde al asistente

Se maneja con el teclado (flechas, Intro, Esc) o con el ratón. Pulsa `?` para ver la ayuda de cada pantalla. Los pasos son:

1. **Idioma y comprobaciones.** Elige español o inglés. El asistente comprueba puertos, espacio en disco y tu sistema.
2. **¿Dónde quieres jugar?** Es la decisión más importante:
   - **Mi equipo con enlace público:** lo más fácil. Tu ordenador hace de servidor y un túnel de Cloudflare te da un enlace `https`. Sin cuenta ni coste. Limitaciones: tu equipo debe estar encendido durante la partida y el enlace rápido cambia cada vez que se reinicia.
   - **Oracle Cloud gratis:** una máquina siempre encendida sin coste, pero pide crear una cuenta con tarjeta (para verificarla). El asistente te guía paso a paso.
   - **VPS de pago:** un servidor barato (Hetzner o DigitalOcean) que el asistente crea por ti con un token de API.
   - **Solo red local / NAS:** para jugar en la misma casa o con Docker. Ojo: el micrófono solo funciona con `https` o en el propio equipo.
3. **Nombre y HTTPS.** En servidores remotos puedes usar tu dominio o uno automático con `sslip.io`; el certificado se pide solo.
4. **Inteligencia artificial (opcional).** Puedes saltarla: Lantern funciona igual. Si la quieres, elige un proveedor (hay gratuitos), el asistente abre la página donde se crea la clave, tú la pegas (no se ve en pantalla) y él la prueba.
5. **Voz para mesas grandes (opcional).** Hasta unas 6 personas no hace falta.
6. **Tu mesa.** Escribe tu nombre de DM y el título de la mesa. Puedes empezar vacía o importar una campaña de Lantern (`.zip`) o un mapa `.dd2vtt`/`.uvtt`.
7. **Arranque automático.** Elige si Lantern debe arrancar al encender el equipo.
8. **Listo.** Verás el **enlace de invitación**, el **código de la mesa** y un **QR**.

## 4. Comparte el enlace

Envía el enlace (o el código, o el QR) a tus jugadores. Solo necesitan un navegador; funcionan móvil y tablet. Para volver a verlo: abre una terminal y escribe `lantern` (Panel > «Enlace y QR»).

## Avisos del sistema operativo

Los programas de Lantern aún no llevan firma de desarrollador de pago, así que el sistema puede avisarte la primera vez. Es esperado.

- **Windows SmartScreen** («Windows protegió su PC»): pulsa **Más información** y luego **Ejecutar de todas formas**. El instalador ya desbloquea el archivo, así que normalmente no lo verás si usas el comando.
- **macOS Gatekeeper** («no se puede abrir porque no se puede verificar al desarrollador»): el comando ya quita la cuarentena. Si te sale igualmente, clic derecho sobre el archivo > **Abrir**, o en la terminal: `xattr -d com.apple.quarantine ~/.local/bin/lantern`. También en Ajustes del Sistema > Privacidad y seguridad > «Abrir igualmente».
- **Antivirus:** si bloquea el `.exe`, comprueba que lo descargaste de la página oficial de releases y añade una excepción.

## Problemas frecuentes

| Problema | Qué hacer |
|---|---|
| `no se pudo descargar` | Revisa tu conexión. Si pusiste una versión (`LANTERN_VERSION`), comprueba que existe en las releases. |
| `el hash SHA-256 no coincide` | La descarga se corrompió o alguien la manipuló. No se instaló nada: vuelve a intentarlo; si persiste, [abre una incidencia](https://github.com/lanterndevv/lantern/issues). |
| `arquitectura no soportada` | Hay binarios para x64 y arm64 (Linux/macOS) y x64 (Windows). Windows arm64 no está soportado aún. |
| `lantern` no se reconoce como comando | Cierra y abre la terminal (el instalador añade la carpeta al PATH). En Linux/macOS asegúrate de tener `~/.local/bin` en el PATH, o ejecútalo con la ruta completa. |
| El enlace no abre desde fuera de casa | Elige «Mi equipo con enlace público» u otro modo remoto; la red local solo llega dentro de casa. |
| No funciona el micrófono | Los navegadores solo lo permiten en `https` o `localhost`. Usa un enlace `https`. |
| El enlace rápido cambió | Es normal en el túnel rápido: abre `lantern` para ver el nuevo, o usa un dominio propio. |
| Puerto ocupado | Cierra el programa que use el 8787 o cambia el puerto en la configuración (`lantern` > Cambiar configuración). |

Si algo falla, `lantern` > **Registros** muestra qué pasó. Adjúntalo (sin claves) al abrir una incidencia.

## Actualizar

Vuelve a ejecutar el mismo comando de instalación, o abre `lantern` > **Actualizar Lantern**. Tus mesas y archivos se conservan.

## Desinstalar

1. Abre una terminal y escribe `lantern`.
2. Elige **Desinstalar** y confirma. Detiene el servicio, quita el arranque automático y el túnel.
3. Opcional: borra el propio asistente.
   - Linux/macOS: `rm ~/.local/bin/lantern`
   - Windows (PowerShell): `Remove-Item -Recurse $env:LOCALAPPDATA\Lantern`
4. Tus datos (mesas, mapas) están en la carpeta de datos: `~/.config/lantern` (Linux), `~/Library/Application Support/Lantern` (macOS) o `%AppData%\Lantern` (Windows). Bórrala solo si ya no los quieres; **antes exporta las campañas que quieras conservar**.
