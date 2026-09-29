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
			a.t("Instala aquí y publica con un túnel de Cloudflare (HTTPS incluido).", "Installs here and publishes through a Cloudflare tunnel (HTTPS included)."),
			a.t("+ Gratis, sin abrir puertos   − Tu PC debe estar encendido para jugar", "+ Free, no open ports   − Your PC must be on to play")}},
		{title: a.t("Oracle Cloud gratis", "Oracle Cloud free"), tag: "oracle", lines: []string{
			a.t("Una máquina Arm gratuita (2 CPU, 12 GB) siempre encendida. Te guío paso a paso.", "A free always-on Arm machine (2 CPU, 12 GB). I guide you step by step."),
			a.t("+ Gratis y 24/7   − Pide tarjeta para verificar; a veces no hay capacidad", "+ Free and 24/7   − Needs a card to verify; capacity is sometimes out")}},
		{title: a.t("VPS automático (Hetzner / DigitalOcean)", "Automatic VPS (Hetzner / DigitalOcean)"), tag: "vps", lines: []string{
			a.t("Creo el servidor por ti con tu token de API y lo dejo listo con HTTPS.", "I create the server for you with your API token and set up HTTPS."),
			a.t("+ Lo más cómodo y estable   − Unos 4–6 €/mes", "+ Easiest and most stable   − About 4–6 EUR/month")}},
		{title: a.t("Red local / NAS", "Local network / NAS"), tag: "lan", lines: []string{
			a.t("Solo dentro de tu casa: en este equipo o con Docker en un NAS.", "Only inside your home: on this machine or with Docker on a NAS."),
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
	f := huh.NewForm(huh.NewGroup(huh.NewInput().Title(a.t("Nombre de host", "Hostname")).
		Description(a.t("Un subdominio de un dominio que ya está en tu cuenta de Cloudflare.", "A subdomain of a domain already in your Cloudflare account.")).
		Placeholder("mesa.midominio.com").Value(&a.cfg.Domain).Validate(validHost)))
	s := newForm(a, 2, a.t("Se abrirá el navegador para que autorices a Lantern en tu cuenta de Cloudflare.", "Your browser will open so you can authorize Lantern on your Cloudflare account."), f, done)
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
			return a.th.Title.Render(a.t("Red local", "Local network")) + "\n" + a.th.Bad.Render(a.t("Aviso: ", "Note: ")) +
				wrap(a.t("sin HTTPS el navegador bloquea el micrófono, así que la voz solo funciona en el propio equipo donde corre Lantern. Para el resto, vuelve atrás y elige «Mi PC + enlace» (túnel).",
					"without HTTPS the browser blocks the microphone, so voice only works on the machine running Lantern. For everyone else, go back and pick “My PC + link” (tunnel)."), w)
		},
		pick: func(a *App, i int) tea.Cmd {
			a.cfg.Docker = items[i].tag == "docker"
			return a.toAI()
		}}
}

// Oracle: guía + datos de conexión.
func oracleGuide(a *App) screen {
	key, pub, err := remote.EnsureKey(a.cfg.DataDir)
	if err == nil {
		a.cfg.SSHKeyPath = key
	}
	a.cfg.SSHUser = "ubuntu"
	return &textScreen{base: base{2}, hint: a.th.Muted.Render(a.t("o abrir Oracle Cloud · Enter continuar cuando tengas la IP", "o open Oracle Cloud · Enter to continue once you have the IP")),
		render: func(a *App, w int) string {
			if err != nil {
				return a.th.Bad.Render(err.Error())
			}
			lang := "es"
			if !a.es() {
				lang = "en"
			}
			return a.th.Title.Render(a.t("Oracle Cloud: crea tu máquina gratis", "Oracle Cloud: create your free machine")) + "\n\n" + wrap(cloud.OracleGuide(lang, pub), w+10)
		},
		keys:  map[string]func(*App) tea.Cmd{"o": func(a *App) tea.Cmd { _ = platform.OpenURL(cloud.OracleSignupURL); return nil }},
		enter: func(a *App) tea.Cmd { return a.goTo(remoteForm(a)) },
		help:  a.t("Esta clave SSH la generó el asistente y solo se usa para entrar en tu máquina de Oracle. La parte privada no sale de tu equipo.", "This SSH key was generated by the assistant and is only used to log into your Oracle machine. The private part never leaves your computer."),
	}
}

func remoteForm(a *App) screen {
	f := huh.NewForm(huh.NewGroup(
		huh.NewInput().Title(a.t("IP pública de la máquina", "Machine public IP")).Value(&a.cfg.SSHHost).Validate(func(s string) error {
			if strings.TrimSpace(s) == "" {
				return fmt.Errorf("%s", a.t("escribe la IP", "enter the IP"))
			}
			return nil
		}),
		huh.NewInput().Title(a.t("Usuario SSH", "SSH user")).Value(&a.cfg.SSHUser),
		huh.NewInput().Title(a.t("Dominio (opcional)", "Domain (optional)")).
			Description(a.t("Vacío: uso <ip>.sslip.io con certificado HTTPS automático.", "Empty: I use <ip>.sslip.io with an automatic HTTPS certificate.")).Value(&a.cfg.Domain),
	))
	return newForm(a, 2, "", f, func(a *App) tea.Cmd { return a.toAI() })
}

// VPS.
func vpsProviderMenu(a *App) screen {
	hz, do := cloud.HetznerInfo, cloud.DigitalOceanInfo
	items := []item{{title: hz.Name, tag: "hetzner", lines: []string{hz.Price}}, {title: do.Name, tag: "digitalocean", lines: []string{do.Price}}}
	return &menuScreen{base: base{2}, ch: newChoice(items, 0), numbered: true,
		intro: func(a *App, w int) string {
			return a.th.Title.Render(a.t("¿Con qué proveedor?", "Which provider?")) + "\n" + a.t("Crearé un servidor pequeño con tu token de API. Se cobra por horas.", "I will create a small server with your API token. Billed hourly.")
		},
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
			lang := map[bool]string{true: "es", false: "en"}[a.es()]
			return a.goTo(&textScreen{base: base{2}, hint: a.th.Muted.Render(a.t("o abrir la página del token · Enter cuando lo tengas copiado", "o open the token page · Enter once you copied it")),
				render: func(a *App, w int) string {
					return a.th.Title.Render(a.t("Token de ", "API token for ")+info.Name) + "\n\n" + wrap(info.TokenSteps[lang], w) + "\n\n" + a.th.Accent.Render(info.TokenURL)
				},
				keys: map[string]func(*App) tea.Cmd{"o": func(a *App) tea.Cmd { _ = platform.OpenURL(info.TokenURL); return nil }},
				enter: func(a *App) tea.Cmd {
					f := huh.NewForm(huh.NewGroup(
						huh.NewInput().Title(a.t("Pega tu token", "Paste your token")).EchoMode(huh.EchoModePassword).Value(&a.cfg.CloudToken).
							Validate(func(s string) error {
								if len(strings.TrimSpace(s)) < 10 {
									return fmt.Errorf("%s", a.t("el token parece incompleto", "the token looks incomplete"))
								}
								return nil
							}),
						huh.NewInput().Title(a.t("Dominio (opcional)", "Domain (optional)")).
							Description(a.t("Vacío: uso <ip>.sslip.io con HTTPS automático.", "Empty: I use <ip>.sslip.io with automatic HTTPS.")).Value(&a.cfg.Domain)))
					return a.goTo(newForm(a, 2, a.t("El token no se muestra ni se guarda: solo se usa ahora para crear el servidor.", "The token is not shown or stored: it is only used now to create the server."), f, func(a *App) tea.Cmd { return a.toAI() }))
				},
				help: a.t("El servidor se crea en tu cuenta. Si algo falla, el servidor no se borra solo: puedes reintentar con su IP o eliminarlo desde el panel del proveedor.", "The server is created in your account. If something fails it is not deleted automatically: retry with its IP or delete it in the provider's console."),
			})
		}}
}

// ---------- utilidades ----------

func homeDir() string { h, _ := os.UserHomeDir(); return h }

var _ = filepath.Join
