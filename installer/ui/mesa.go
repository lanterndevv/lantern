package ui

import (
	"fmt"
	"runtime"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"

	"lantern/installer/platform"
)

// ---------- 4. Tu mesa ----------

func (a *App) toTable() tea.Cmd {
	if a.cfg.Docker {
		return a.toSummary()
	}
	if a.cfg.DMName == "" {
		a.cfg.DMName = "DM"
	}
	if a.cfg.Title == "" {
		a.cfg.Title = a.t("Mi primera mesa", "My first table")
	}
	f := huh.NewForm(huh.NewGroup(
		huh.NewInput().Title(a.t("¿Cómo te llamas como DM?", "What is your DM name?")).Value(&a.cfg.DMName).Validate(func(s string) error {
			if strings.TrimSpace(s) == "" {
				return fmt.Errorf("%s", a.t("escribe un nombre", "enter a name"))
			}
			return nil
		}),
		huh.NewInput().Title(a.t("Título de la mesa", "Table title")).Value(&a.cfg.Title),
	))
	s := newForm(a, 4, a.t("Voy a crear tu primera mesa. Tus jugadores entrarán con un enlace y un código.", "I will create your first table. Your players join with a link and a code."), f, func(a *App) tea.Cmd { return a.toImport() })
	s.help = a.t("El nombre de DM es el que verán tus jugadores. El título es el de la mesa (puedes cambiarlo luego).", "The DM name is what your players see. The title is the table's name (changeable later).")
	return a.goTo(s)
}

func (a *App) toImport() tea.Cmd {
	if a.cfg.Mode == "oracle" || a.cfg.Mode == "vps" { // la importación va por el endpoint local
		return a.goTo(linkScreen(a))
	}
	items := []item{
		{title: a.t("Empezar con una mesa vacía", "Start with an empty table"), tag: "none"},
		{title: a.t("Importar una campaña de Lantern (.zip)", "Import a Lantern campaign (.zip)"), tag: "zip", lines: []string{a.t("Una copia exportada de otra mesa de Lantern.", "An export from another Lantern table.")}},
		{title: a.t("Importar un mapa (.dd2vtt / .uvtt)", "Import a map (.dd2vtt / .uvtt)"), tag: "uvtt", lines: []string{a.t("Mapas de Dungeondraft y otros con muros y luces.", "Maps from Dungeondraft and others with walls and lights.")}},
	}
	return a.goTo(&menuScreen{base: base{4}, ch: newChoice(items, 0),
		intro: func(a *App, w int) string {
			return a.th.Title.Render(a.t("¿Quieres importar algo ahora?", "Do you want to import something now?"))
		},
		pick: func(a *App, i int) tea.Cmd {
			a.cfg.ImportPath = ""
			if items[i].tag == "none" {
				return a.goTo(linkScreen(a))
			}
			types := []string{".zip"}
			if items[i].tag == "uvtt" {
				types = []string{".dd2vtt", ".uvtt"}
			}
			fp := huh.NewFilePicker().Title(a.t("Elige el archivo", "Choose the file")).CurrentDirectory(homeDir()).
				AllowedTypes(types).Height(12).Value(&a.cfg.ImportPath)
			return a.goTo(newForm(a, 4, a.t("Navega con las flechas; Enter abre carpetas o elige el archivo.", "Browse with the arrows; Enter opens folders or selects the file."),
				huh.NewForm(huh.NewGroup(fp)), func(a *App) tea.Cmd { return a.goTo(linkScreen(a)) }))
		}})
}

// Lantern Link: cómo traer personajes de D&D Beyond.
func linkScreen(a *App) screen {
	return &textScreen{base: base{4}, kh: [][2]string{{"enter", a.t("continuar", "continue")}, {"esc", a.t("atrás", "back")}, {"?", a.t("ayuda", "help")}, {"q", a.t("salir", "quit")}},
		enter: func(a *App) tea.Cmd { return a.toSummary() },
		help:  a.t("Es opcional: Lantern funciona sin D&D Beyond. Link solo lee tu sesión en dndbeyond.com y nunca envía tu token al servidor.", "It is optional: Lantern works without D&D Beyond. Link only reads your dndbeyond.com session and never sends your token to the server."),
		render: func(a *App, w int) string {
			return a.th.Title.Render(a.t("Personajes de D&D Beyond con Lantern Link", "D&D Beyond characters with Lantern Link")) + "\n\n" + wrap(a.t(
				"Lantern Link es una extensión de Chrome/Firefox que importa personajes y monstruos de tu cuenta de D&D Beyond. Es opcional y cada jugador la instala en su navegador.\n\n"+
					"1. Descarga la carpeta «link» de Lantern (apps/link en el repositorio o el .zip de la release).\n"+
					"2. Chrome/Edge: abre chrome://extensions, activa «Modo desarrollador» y pulsa «Cargar descomprimida»; elige la carpeta.\n"+
					"   Firefox: abre about:debugging#/runtime/this-firefox y pulsa «Cargar complemento temporal»; elige manifest.json.\n"+
					"3. Inicia sesión en dndbeyond.com con tu cuenta.\n"+
					"4. Abre tu mesa de Lantern: en la hoja de personaje aparece «Importar de D&D Beyond».\n\n"+
					"Solo se traen estadísticas de juego, nunca textos de reglas.",
				"Lantern Link is a Chrome/Firefox extension that imports characters and monsters from your D&D Beyond account. It is optional and each player installs it in their browser.\n\n"+
					"1. Get Lantern's “link” folder (apps/link in the repository or the release .zip).\n"+
					"2. Chrome/Edge: open chrome://extensions, enable “Developer mode” and click “Load unpacked”; pick the folder.\n"+
					"   Firefox: open about:debugging#/runtime/this-firefox and click “Load Temporary Add-on”; pick manifest.json.\n"+
					"3. Sign in to dndbeyond.com with your account.\n"+
					"4. Open your Lantern table: the character sheet shows “Import from D&D Beyond”.\n\n"+
					"Only game statistics are imported, never rules text."), w)
		}}
}

// Resumen previo a instalar.
func summaryScreen(a *App) screen {
	return &textScreen{base: base{4}, kh: [][2]string{{"enter", a.t("instalar", "install")}, {"esc", a.t("cambiar algo", "change something")}, {"?", a.t("ayuda", "help")}, {"q", a.t("salir", "quit")}},
		enter: func(a *App) tea.Cmd { return a.goTo(newInstallScreen(a)) },
		help:  a.t("Nada se instala hasta que pulses Enter.", "Nothing is installed until you press Enter."),
		render: func(a *App, w int) string {
			c := a.cfg
			row := func(k, v string) string { // el valor se parte por palabras y las líneas siguientes quedan alineadas
				return a.th.Muted.Render(fmt.Sprintf("%-16s", k)) + strings.ReplaceAll(wrap(v, w-16), "\n", "\n"+strings.Repeat(" ", 16))
			}
			mode := map[string]string{"local": a.t("Mi PC + enlace", "My PC + link"), "oracle": "Oracle Cloud", "vps": "VPS " + c.CloudProvider, "lan": a.t("Red local", "Local network")}[c.Mode]
			link := map[string]string{"quick": a.t("enlace rápido de Cloudflare", "Cloudflare quick link"), "named": c.Domain, "none": a.t("sin túnel", "no tunnel")}[c.Tunnel]
			if c.Mode == "oracle" || c.Mode == "vps" {
				link = c.Domain
				if link == "" {
					link = "<ip>.sslip.io (HTTPS)"
				}
			}
			ln := []string{a.th.Title.Render(a.t("Todo listo para instalar", "Ready to install")), "",
				row(a.t("Dónde", "Where"), mode), row(a.t("Enlace", "Link"), link)}
			if c.Docker {
				ln = append(ln, row("Docker", a.t("docker-compose para NAS", "docker-compose for NAS")))
			}
			ai1 := a.t("ninguna", "none")
			if c.LLM != nil {
				ai1 = c.LLM.ID + " · " + c.LLM.Model + " · " + mask(c.LLM.Key)
				if c.LLM2 != nil {
					ai1 += "  +  " + c.LLM2.ID
				}
			}
			ln = append(ln, row("IA", ai1))
			if !c.Docker {
				ln = append(ln, row(a.t("Laya (IA local)", "Laya (local AI)"), map[bool]string{true: a.t("sí", "yes"), false: a.t("no", "no")}[c.Laya]),
					row(a.t("Mesa", "Table"), c.Title+" · DM "+c.DMName))
				if c.ImportPath != "" {
					ln = append(ln, row(a.t("Importar", "Import"), c.ImportPath))
				}
			}
			if c.Mode == "local" || (c.Mode == "lan" && !c.Docker) {
				ln = append(ln, row(a.t("Datos en", "Data in"), c.DataDir))
				ln = append(ln, "", a.th.Accent.Render(a.t("Arranque automático", "Autostart")))
				kind := platform.Backend(c.NoService)
				desc := map[string]string{
					"systemd":  a.t("servicio de usuario de systemd", "systemd user service"),
					"launchd":  a.t("LaunchAgent de macOS", "macOS LaunchAgent"),
					"schtasks": a.t("tarea programada al iniciar sesión", "scheduled task at logon"),
					"process":  a.t("proceso en segundo plano (sin arranque automático en este sistema)", "background process (no autostart on this system)"),
				}[kind]
				ln = append(ln, "  "+desc)
			}
			return strings.Join(ln, "\n")
		}}
}

// toSummary pregunta por el arranque sin sesión (linger) en Linux/systemd y muestra el resumen.
func (a *App) toSummary() tea.Cmd {
	c := a.cfg
	if runtime.GOOS == "linux" && !c.Docker && (c.Mode == "local" || c.Mode == "lan") && platform.Backend(c.NoService) == "systemd" {
		items := []item{
			{title: a.t("Sí, que arranque al encender el equipo", "Yes, start it when the computer boots"), lines: []string{a.t("Ejecuta «loginctl enable-linger»: tu servicio de usuario sigue activo aunque no hayas iniciado sesión.", "Runs “loginctl enable-linger”: your user service keeps running even when you are not logged in.")}},
			{title: a.t("No, solo cuando inicie sesión", "No, only when I log in"), lines: []string{a.t("No cambia ningún ajuste del sistema.", "Changes no system setting.")}},
		}
		return a.goTo(&menuScreen{base: base{4}, ch: newChoice(items, 1),
			intro: func(a *App, w int) string {
				return a.th.Title.Render(a.t("¿Arrancar Lantern sin iniciar sesión?", "Start Lantern without logging in?"))
			},
			pick: func(a *App, i int) tea.Cmd { a.cfg.Linger = i == 0; return a.goTo(summaryScreen(a)) }})
	}
	return a.goTo(summaryScreen(a))
}
