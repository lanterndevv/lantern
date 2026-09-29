package ui

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"

	"lantern/installer/cloud"
	"lantern/installer/engine"
	"lantern/installer/lantern"
	"lantern/installer/platform"
	"lantern/installer/remote"
)

// ---------- 0. Bienvenida ----------

type welcome struct {
	base
	ch          *choice
	port        int
	diskGB      float64
	archOK      bool
	archName    string
	portChanged bool
}

func newWelcome(a *App) *welcome {
	w := &welcome{base: base{0}}
	w.ch = newChoice([]item{{title: "Español"}, {title: "English"}}, 0)
	if !a.es() {
		w.ch.sel = 1
	}
	w.port = a.cfg.Port
	if w.port == 0 {
		w.port = engine.DefaultPort
	}
	for p := w.port; p < w.port+50; p++ {
		if engine.PortFree(p) {
			w.portChanged = p != w.port
			w.port = p
			break
		}
	}
	// Si hay una instalación previa usando el puerto, no es un conflicto.
	w.diskGB = float64(platform.FreeDisk(a.o.Paths.Data)) / (1 << 30)
	n, err := lantern.AssetName(runtime.GOOS, runtime.GOARCH)
	w.archName = fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH)
	w.archOK = err == nil || a.cfg.ServerBin != ""
	_ = n
	return w
}

func (s *welcome) Update(a *App, msg tea.Msg) tea.Cmd {
	if s.ch.update(msg) {
		if !s.archOK {
			return nil
		}
		a.cfg.Port = s.port
		return a.goTo(modeMenu(a))
	}
	a.cfg.Lang = []string{"es", "en"}[s.ch.sel]
	return nil
}
func (s *welcome) Help(a *App) string {
	return a.t("Lantern es una mesa virtual de rol. Este asistente instala el servidor, lo publica en Internet si quieres, configura la IA y crea tu primera mesa. Elige el idioma y pulsa Enter.",
		"Lantern is a virtual tabletop. This assistant installs the server, publishes it online if you want, sets up AI and creates your first table. Pick a language and press Enter.")
}
func (s *welcome) View(a *App, w, h int) string {
	ok := func(good bool, txt string) string {
		if good {
			return a.th.Good.Render("  ✓ ") + txt
		}
		return a.th.Bad.Render("  ✗ ") + txt
	}
	var b strings.Builder
	b.WriteString(a.th.Title.Render(a.t("Bienvenida a Lantern", "Welcome to Lantern")) + "\n")
	b.WriteString(wrap(a.t("Vamos a instalar tu mesa virtual en unos minutos. Solo te haré preguntas sencillas; el resto lo hago yo.",
		"We will set up your virtual tabletop in a few minutes. I will only ask simple questions; I do the rest."), w) + "\n\n")
	b.WriteString(a.th.Accent.Render(a.t("Comprobaciones", "Checks")) + "\n")
	portTxt := a.t(fmt.Sprintf("Puerto %d libre", s.port), fmt.Sprintf("Port %d free", s.port))
	if s.portChanged {
		portTxt += a.t(" (el habitual estaba ocupado)", " (the usual one was busy)")
	}
	b.WriteString(ok(true, portTxt) + "\n")
	b.WriteString(ok(s.diskGB >= 1, a.t(fmt.Sprintf("Espacio en disco: %.1f GB libres", s.diskGB), fmt.Sprintf("Disk space: %.1f GB free", s.diskGB))) + "\n")
	b.WriteString(ok(s.archOK, a.t("Sistema: ", "System: ")+s.archName+map[bool]string{true: "", false: a.t(" (no soportado)", " (unsupported)")}[s.archOK]) + "\n\n")
	b.WriteString(a.th.Accent.Render(a.t("Idioma / Language", "Language / Idioma")) + "\n")
	s.ch.Y0 = strings.Count(b.String(), "\n")
	b.WriteString(s.ch.view(a.th, w, 4, false))
	return b.String()
}

// ---------- 1. ¿Dónde jugar? ----------

func modeMenu(a *App) screen {
	items := []item{
		{title: a.t("Mi PC + enlace público", "My PC + public link"), tag: "local", lines: []string{
			a.t("Se instala en este ordenador y te doy un enlace de Internet para tus jugadores (con un túnel de Cloudflare, HTTPS incluido).", "Installs on this computer and gives your players an Internet link (through a Cloudflare tunnel, HTTPS included)."),
			a.t("+ Gratis, sin abrir puertos   − Tu PC debe estar encendido para jugar", "+ Free, no open ports   − Your PC must be on to play")}},
		{title: a.t("Oracle Cloud gratis", "Oracle Cloud free"), tag: "oracle", lines: []string{
			a.t("Un servidor gratis en Internet, siempre encendido. Tú haces unos clics en la web de Oracle y yo te guío paso a paso (unos 20 minutos).", "A free always-on server on the Internet. You click through Oracle's website and I guide you step by step (about 20 minutes)."),
			a.t("+ Gratis y siempre encendido   − Pide tarjeta para verificar (no cobra); a veces no hay hueco", "+ Free and always on   − Needs a card to verify (no charge); sometimes no room")}},
		{title: a.t("VPS automático (Hetzner / DigitalOcean)", "Automatic VPS (Hetzner / DigitalOcean)"), tag: "vps", lines: []string{
			a.t("Alquilo un servidor por ti en Hetzner o DigitalOcean (necesitas una cuenta allí) y lo dejo listo con HTTPS.", "I rent a server for you at Hetzner or DigitalOcean (you need an account there) and set it up with HTTPS."),
			a.t("+ Lo más cómodo y estable   − Unos 4–6 € al mes", "+ Easiest and most stable   − About 4–6 EUR per month")}},
		{title: a.t("Red local / NAS", "Local network / NAS"), tag: "lan", lines: []string{
			a.t("Solo dentro de tu casa: en este ordenador o en un NAS (un disco de red) con Docker.", "Only inside your home: on this computer or on a NAS (a network drive) with Docker."),
			a.t("+ Privado y gratis   − Sin HTTPS: la voz solo va en el propio PC", "+ Private and free   − No HTTPS: voice only works on the PC itself")}},
	}
	return &menuScreen{base: base{1}, ch: newChoice(items, 0), numbered: true,
		intro: func(a *App, w int) string {
			return a.th.Title.Render(a.t("¿Dónde quieres jugar?", "Where do you want to play?")) + "\n" + a.th.Muted.Render(a.t("Puedes cambiarlo más tarde desde el panel.", "You can change this later from the dashboard."))
		},
		help: a.t("Mi PC es lo más rápido para probar. Un servidor (Oracle o VPS) permite jugar sin dejar tu ordenador encendido.", "My PC is the fastest way to try it. A server (Oracle or VPS) lets you play without leaving your computer on."),
		pick: func(a *App, i int) tea.Cmd {
			a.cfg.Mode = items[i].tag
			a.cfg.Tunnel, a.cfg.Docker = "none", false
			switch a.cfg.Mode {
			case "local":
				return a.goTo(localHostMenu(a))
			case "lan":
				return a.goTo(lanMenu(a))
			case "oracle":
				return a.goTo(oracleGuide(a))
			}
			return a.goTo(vpsProviderMenu(a))
		}}
}

// ---------- 2. Nombre / HTTPS ----------

func localHostMenu(a *App) screen {
	items := []item{
		{title: a.t("Enlace rápido (sin cuenta)", "Quick link (no account)"), tag: "quick", lines: []string{
			a.t("Un https://…trycloudflare.com al instante. Cambia cada vez que se reinicia el túnel (límite: 200 conexiones simultáneas).", "An instant https://…trycloudflare.com. It changes whenever the tunnel restarts (limit: 200 concurrent connections).")}},
		{title: a.t("Dominio propio", "Own domain"), tag: "named", lines: []string{
			a.t("Enlace fijo tipo mesa.tudominio.com. Necesita una cuenta de Cloudflare gratuita con tu dominio.", "Fixed link like table.yourdomain.com. Needs a free Cloudflare account with your domain.")}},
	}
	return &menuScreen{base: base{2}, ch: newChoice(items, 0), numbered: true,
		intro: func(a *App, w int) string {
			return a.th.Title.Render(a.t("¿Qué enlace quieres para tus jugadores?", "What link do you want for your players?")) + "\n" +
				wrap(a.t("El túnel de Cloudflare pone el HTTPS, necesario para la voz y el micrófono.", "The Cloudflare tunnel provides HTTPS, needed for voice and microphone."), w)
		},
		help: a.t("El enlace rápido es ideal para probar: no hay que registrarse. Si juegas cada semana, un dominio propio evita tener que reenviar el enlace.", "The quick link is great to try: no sign-up. If you play weekly, an own domain saves you from resending the link."),
		pick: func(a *App, i int) tea.Cmd {
			a.cfg.Tunnel = items[i].tag
			if a.cfg.Tunnel == "quick" {
				return a.toAI()
			}
			return a.goTo(domainForm(a, "", func(a *App) tea.Cmd { return a.toAI() }))
		}}
}

func validHost(s string) error {
	s = strings.TrimSpace(s)
	if strings.Contains(s, "://") || strings.ContainsAny(s, " /") || !strings.Contains(s, ".") {
		return fmt.Errorf("escribe solo el nombre, p. ej. mesa.midominio.com")
	}
	return nil
}

func domainForm(a *App, intro string, done func(*App) tea.Cmd) screen {
	f := huh.NewForm(huh.NewGroup(huh.NewInput().Title(a.t("¿Qué dirección quieres para tu mesa?", "What address do you want for your table?")).
		Description(a.t("Tus jugadores la escribirán en el navegador. Debe colgar de un dominio tuyo que ya esté en Cloudflare (gratis), p. ej. mesa.midominio.com.", "Your players will type it in the browser. It must hang from a domain of yours already on Cloudflare (free), e.g. table.mydomain.com.")).
		Placeholder("mesa.midominio.com").Value(&a.cfg.Domain).Validate(validHost)))
	s := newForm(a, 2, a.t("Al continuar se abrirá el navegador para que dejes a Lantern usar tu cuenta de Cloudflare (es solo un «Autorizar»).", "When you continue your browser will open so you can let Lantern use your Cloudflare account (just click \"Authorize\")."), f, done)
	s.help = a.t("Cloudflare debe gestionar el DNS de tu dominio. El asistente crea el túnel y el registro DNS por ti.", "Cloudflare must manage your domain's DNS. The assistant creates the tunnel and DNS record for you.")
	return s
}

func lanMenu(a *App) screen {
	items := []item{
		{title: a.t("Instalar en este equipo", "Install on this machine"), tag: "here", lines: []string{a.t("Lantern queda accesible desde otros equipos de tu red (http://IP:puerto).", "Lantern becomes reachable from other machines on your network (http://IP:port).")}},
		{title: a.t("Generar docker-compose para un NAS o servidor", "Generate docker-compose for a NAS or server"), tag: "docker", lines: []string{a.t("Te dejo el docker-compose.yml y un lantern.env listos, con instrucciones para Synology, Unraid y TrueNAS.", "I leave a ready docker-compose.yml and lantern.env, with instructions for Synology, Unraid and TrueNAS.")}},
	}
	return &menuScreen{base: base{2}, ch: newChoice(items, 0), numbered: true,
		intro: func(a *App, w int) string {
			return a.th.Title.Render(a.t("Red local", "Local network")) + "\n" + wrap(a.t("Aviso: sin HTTPS el navegador bloquea el micrófono, así que la voz solo funciona en el propio equipo donde corre Lantern. Para el resto, vuelve atrás y elige «Mi PC + enlace» (túnel).",
				"Note: without HTTPS the browser blocks the microphone, so voice only works on the machine running Lantern. For everyone else, go back and pick “My PC + link” (tunnel)."), w)
		},
		pick: func(a *App, i int) tea.Cmd {
			a.cfg.Docker = items[i].tag == "docker"
			if a.cfg.Docker {
				return a.goTo(dockerGuide(a))
			}
			return a.toAI()
		}}
}

// Oracle: la guía paso a paso está en oracle.go; aquí, lo último que falta: el dominio.
func remoteForm(a *App) screen {
	f := huh.NewForm(huh.NewGroup(
		huh.NewInput().Title(a.t("¿Tienes un dominio propio? (opcional)", "Do you have your own domain? (optional)")).
			Description(a.t("Por ejemplo mesa.midominio.com, ya apuntando a la IP de tu máquina. Si lo dejas vacío no pasa nada: uso una dirección gratuita basada en la IP (sslip.io) y el candado HTTPS funciona igual.",
				"For example table.mydomain.com, already pointing to your machine's IP. Leaving it empty is fine: I use a free address based on the IP (sslip.io) and the HTTPS padlock works the same.")).
			Placeholder("mesa.midominio.com").Value(&a.cfg.Domain).Validate(func(s string) error {
			if strings.TrimSpace(s) == "" {
				return nil
			}
			return validHost(s)
		}),
	))
	return newForm(a, 2, a.t("Conexión correcta: llego a tu máquina de Oracle. Última pregunta de este bloque.", "Connection works: I can reach your Oracle machine. Last question of this block."), f, func(a *App) tea.Cmd { return a.toAI() })
}

// dockerGuide explica qué es y qué va a pasar antes de generar los archivos para el NAS.
func dockerGuide(a *App) screen {
	dir := filepath.Join(a.cfg.DataDir, "docker")
	return &textScreen{base: base{2}, hint: a.th.Key.Render("Enter") + " " + a.th.Muted.Render(a.t("continuar · Esc volver", "continue · Esc back")),
		enter: func(a *App) tea.Cmd { return a.toAI() },
		help:  a.t("Docker es un sistema para instalar programas en un NAS sin tocar nada más. Si no sabes qué es, casi seguro que te conviene «Mi PC + enlace público».", "Docker is a way to install programs on a NAS without touching anything else. If you do not know what it is, \"My PC + public link\" is almost certainly what you want."),
		render: func(a *App, w int) string {
			h := func(s string) string { return a.th.Accent.Render(s) }
			return a.th.Title.Render(a.t("Instalar en tu NAS con Docker", "Install on your NAS with Docker")) + "\n\n" +
				h(a.t("Qué es", "What it is")) + "\n" + wrap(a.t("Docker es la forma habitual de instalar programas en un NAS (Synology, Unraid, TrueNAS…). Yo no toco tu NAS: te preparo dos archivos y tú los subes.", "Docker is the usual way to install programs on a NAS (Synology, Unraid, TrueNAS…). I do not touch your NAS: I prepare two files and you upload them."), w) + "\n\n" +
				h(a.t("Cuánto cuesta", "What it costs")) + "\n" + a.t("Nada: usa el NAS que ya tienes.", "Nothing: it uses the NAS you already have.") + "\n\n" +
				h(a.t("Qué va a pasar", "What will happen")) + "\n" + wrap(a.t(
				"• Te haré unas preguntas más (por ejemplo, la IA).\n• Crearé los archivos «docker-compose.yml» y «lantern.env» en:\n  "+dir+"\n• Te explicaré cómo subirlos a tu NAS.\n• Se juega con http://IP-del-NAS:8787 dentro de tu casa. La voz necesita HTTPS y no funcionará desde otros equipos.",
				"• I will ask a few more questions (for example, the AI).\n• I will create \"docker-compose.yml\" and \"lantern.env\" in:\n  "+dir+"\n• I will explain how to upload them to your NAS.\n• You play at http://NAS-IP:8787 inside your home. Voice needs HTTPS and will not work from other machines."), w)
		}}
}

// VPS: qué es y cuánto cuesta (proveedor) -> cómo conseguir el token -> pegarlo -> qué va a pasar.
func vpsProviderMenu(a *App) screen {
	hz, do := cloud.HetznerInfo, cloud.DigitalOceanInfo
	lang := a.pick2("es", "en")
	items := []item{
		{title: hz.Name, tag: "hetzner", lines: []string{hz.Price[lang], a.t("Empresa alemana. Muy fiable y con buen precio.", "German company. Very reliable and good value.")}},
		{title: do.Name, tag: "digitalocean", lines: []string{do.Price[lang], a.t("Empresa estadounidense. Su web es muy sencilla.", "US company. Its website is very simple.")}}}
	return &menuScreen{base: base{2}, ch: newChoice(items, 0), numbered: true,
		intro: func(a *App, w int) string {
			return a.th.Title.Render(a.t("¿Con qué empresa alquilamos el servidor?", "Which company do we rent the server from?")) + "\n" +
				wrap(a.t("Un VPS es un ordenador alquilado en Internet, siempre encendido, donde vivirá tu mesa. Yo lo creo y lo dejo listo con HTTPS; tú solo me das permiso desde tu cuenta. Se cobra por horas y puedes borrarlo cuando quieras desde la web de la empresa.",
					"A VPS is a computer rented on the Internet, always on, where your table will live. I create it and set it up with HTTPS; you only give me permission from your account. It is billed hourly and you can delete it any time from the company's website."), w)
		},
		help: a.t("Necesitas una cuenta en la empresa (con tarjeta). Hasta el paso «Instalar» no se crea ni se cobra nada.", "You need an account with the company (with a card). Nothing is created or charged until the \"Install\" step."),
		pick: func(a *App, i int) tea.Cmd {
			a.cfg.CloudProvider = items[i].tag
			info := hz
			if items[i].tag == "digitalocean" {
				info = do
			}
			key, _, err := remote.EnsureKey(a.cfg.DataDir)
			if err != nil {
				return nil
			}
			a.cfg.SSHKeyPath = key
			a.cfg.SSHUser = "ubuntu"
			return a.goTo(&textScreen{base: base{2}, hint: a.th.Key.Render("o") + " " + a.th.Muted.Render(a.t("abrir la página del token · ", "open the token page · ")) + a.th.Key.Render("Enter") + " " + a.th.Muted.Render(a.t("cuando lo tengas copiado", "once you copied it")),
				render: func(a *App, w int) string {
					return a.th.Title.Render(a.t("Consigue tu token de ", "Get your token from ")+info.Name) + "\n\n" +
						wrap(a.t("Un «token» es una contraseña especial que deja a Lantern crear el servidor en tu cuenta sin conocer tu contraseña de verdad. Lo creas tú en la web de "+info.Name+":", "A \"token\" is a special password that lets Lantern create the server in your account without knowing your real password. You create it on the "+info.Name+" website:"), w) + "\n\n" +
						wrap(info.TokenSteps[a.pick2("es", "en")], w) + "\n\n" + a.th.Muted.Render(a.t("Coste: ", "Cost: ")+info.Price[a.pick2("es", "en")])
				},
				keys: map[string]func(*App) tea.Cmd{"o": func(a *App) tea.Cmd { _ = platform.OpenURL(info.TokenURL); return nil }},
				enter: func(a *App) tea.Cmd {
					f := huh.NewForm(huh.NewGroup(
						huh.NewInput().Title(a.t("Pega tu token", "Paste your token")).Description(a.t("No se verá en pantalla mientras lo pegas.", "It will not be shown on screen while you paste it.")).
							EchoMode(huh.EchoModePassword).Value(&a.cfg.CloudToken).
							Validate(func(s string) error {
								if len(strings.TrimSpace(s)) < 10 {
									return fmt.Errorf("%s", a.t("el token parece incompleto", "the token looks incomplete"))
								}
								return nil
							}),
						huh.NewInput().Title(a.t("¿Tienes un dominio propio? (opcional)", "Do you have your own domain? (optional)")).
							Description(a.t("Vacío: uso una dirección gratuita basada en la IP (sslip.io), con HTTPS igualmente.", "Empty: I use a free address based on the IP (sslip.io), with HTTPS anyway.")).Value(&a.cfg.Domain)))
					return a.goTo(newForm(a, 2, a.t("Qué va a pasar: al final, en «Instalar», crearé el servidor en tu cuenta de "+info.Name+" (1-2 minutos) y lo dejaré funcionando. Desde ahí empieza a cobrarse. El token no se guarda: solo se usa en ese momento.",
						"What will happen: at the end, in \"Install\", I will create the server in your "+info.Name+" account (1-2 minutes) and leave it running. Billing starts from then. The token is not stored: it is only used at that moment."), f, func(a *App) tea.Cmd { return a.toAI() }))
				},
				help: a.t("El servidor se crea en tu cuenta. Si algo falla, el servidor no se borra solo: puedes reintentar con su IP o eliminarlo desde la web de la empresa.", "The server is created in your account. If something fails it is not deleted automatically: retry with its IP or delete it from the company's website."),
			})
		}}
}

// ---------- utilidades ----------

func homeDir() string { h, _ := os.UserHomeDir(); return h }

var _ = filepath.Join
