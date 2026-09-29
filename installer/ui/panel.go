package ui

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"charm.land/bubbles/v2/spinner"
	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

	"lantern/installer/engine"
	"lantern/installer/lantern"
	"lantern/installer/platform"
)

type statusMsg struct {
	srv, tun bool
	st       lantern.Status
	err      error
	origin   string
}
type tickMsg struct{}

type panel struct {
	base
	state  engine.State
	loaded bool
	s      statusMsg
	ch     *choice
	note   string
}

func newPanel() *panel { return &panel{base: base{stagePanel}} }

func (p *panel) Init(a *App) tea.Cmd {
	p.state, p.loaded = engine.LoadState(a.o.Paths)
	if p.state.Lang != "" && a.cfg.Lang == "" {
		a.cfg.Lang = p.state.Lang
	}
	remote := p.state.Remote != ""
	items := []item{{title: a.t("Mesas", "Tables")}, {title: a.t("Enlace", "Link")}, {title: "IA"}, {title: a.t("Voz", "Voice")}, {title: a.t("Copias", "Backups")},
		{title: a.t("Registros", "Logs")}, {title: a.t("Actualizar", "Update")}, {disabled: true}, {title: a.t("Desinstalar", "Uninstall"), danger: true}}
	if remote {
		items = []item{{title: a.t("Enlace", "Link")}, {title: a.t("Olvidar esta instalación", "Forget this installation")}}
	}
	p.ch = newChoice(items, 0)
	return tea.Batch(p.refresh(a), tick())
}

func tick() tea.Cmd { return tea.Tick(3*time.Second, func(time.Time) tea.Msg { return tickMsg{} }) }

func (p *panel) refresh(a *App) tea.Cmd {
	st, paths, ctx := p.state, a.o.Paths, a.ctx
	if !p.loaded || st.Remote != "" {
		return nil
	}
	return func() tea.Msg {
		var m statusMsg
		_, _ = engine.SyncOrigin(paths, st) // el enlace rápido puede haber cambiado tras un reinicio
		m.srv, m.tun = engine.Services(paths, st)
		m.origin = lantern.ReadEnv(paths.Env())["LANTERN_ORIGIN"]
		if m.srv {
			c, cancel := context.WithTimeout(ctx, 3*time.Second)
			defer cancel()
			m.st, m.err = engine.Admin(paths, st).Status(c)
		}
		return m
	}
}

func (p *panel) Update(a *App, msg tea.Msg) tea.Cmd {
	switch m := msg.(type) {
	case statusMsg:
		p.s = m
		if m.st.Version != "" {
			a.ver = "v" + m.st.Version + a.t(" · instalado", " · installed")
		}
		return nil
	case tickMsg:
		return tea.Batch(p.refresh(a), tick())
	case tea.KeyPressMsg:
		switch m.String() {
		case "a":
			if p.state.Remote == "" {
				return a.goTo(p.updateScreen(a))
			}
		case "w":
			if p.state.Remote == "" {
				a.o.Panel = false
				return a.reset(newWelcome(a))
			}
		}
	}
	if !p.ch.update(msg) {
		return nil
	}
	if p.state.Remote != "" {
		if p.ch.sel == 0 {
			return a.goTo(p.linkScreen(a))
		}
		_ = os.Remove(a.o.Paths.Data + "/state.json")
		return tea.Quit
	}
	switch p.ch.sel {
	case 0:
		return a.goTo(p.tablesScreen(a))
	case 1:
		return a.goTo(p.linkScreen(a))
	case 2:
		return p.changeAI(a)
	case 3:
		return a.goTo(p.voiceScreen(a))
	case 4:
		return a.goTo(p.backupsScreen(a))
	case 5:
		return a.goTo(p.logsScreen(a))
	case 6:
		return a.goTo(p.updateScreen(a))
	}
	return a.goTo(p.uninstallMenu(a))
}

func (p *panel) Keys(a *App) [][2]string {
	ks := [][2]string{{"↑↓", a.t("moverse", "move")}, {"enter", a.t("abrir", "open")}}
	if p.state.Remote == "" {
		ks = append(ks, [2]string{"a", a.t("actualizar", "update")}, [2]string{"w", a.t("asistente", "assistant")})
	}
	return append(ks, [2]string{"?", a.t("ayuda", "help")}, [2]string{"q", a.t("salir", "quit")})
}

func dot(a *App, on bool) string {
	if on {
		return a.th.Good.Render("●")
	}
	return a.th.Bad.Render("○")
}

func (p *panel) Help(a *App) string {
	return a.t("Aquí ves si Lantern, el túnel y la IA están funcionando. En el menú tienes el enlace, la IA, las copias de seguridad, los registros, actualizar y desinstalar. Con «a» actualizas y con «w» repites el asistente completo (conserva tus datos y mesas).", "Here you see whether Lantern, the tunnel and the AI are running. The menu has the link, the AI, backups, logs, update and uninstall. Press \"a\" to update and \"w\" to run the full assistant again (keeps your data and tables).")
}

func (p *panel) View(a *App, w, h int) string {
	th := a.th
	if !p.loaded {
		return th.Bad.Render(a.t("No encuentro ninguna instalación en ", "No installation found in ") + a.o.Paths.Data)
	}
	const lw = 16
	rw := w - lw - 4
	p.ch.Y0 = 2
	p.ch.radio = false
	left := th.label(a.t("Menú", "Menu")) + "\n\n" + p.ch.view(th, lw, h-3, false)

	row := func(on bool, name, info string) string {
		return dot(a, on) + " " + th.Title.Render(name+strings.Repeat(" ", max(1, 9-lipgloss.Width(name)))) + ansi.Truncate(info, rw-11, "…")
	}
	r := []string{th.label(a.t("Estado", "Status"))}
	if p.state.Remote != "" {
		r = append(r, row(true, a.t("Servidor", "Server"), a.t("remoto: ", "remote: ")+th.Link.Render(p.state.Remote)),
			th.Muted.Render("  "+a.t("Se gestiona por SSH en el propio servidor.", "Managed over SSH on the server itself.")))
	} else {
		info := th.Bad.Render(a.t("Parado", "Stopped"))
		if p.s.srv {
			info = a.t("En marcha", "Running")
			if p.s.st.Version != "" {
				info += th.Muted.Render(" · " + fmt.Sprintf(a.t("%d mesas", "%d tables"), p.s.st.Rooms))
			}
			if p.s.err != nil {
				info += th.Muted.Render(" · " + a.t("sin respuesta del admin", "admin not responding"))
			}
		}
		r = append(r, row(p.s.srv, a.t("Servidor", "Server"), info))
		if p.state.Tunnel != "none" && p.state.Tunnel != "" {
			t := th.Bad.Render(a.t("caído: tus jugadores no pueden entrar", "down: your players cannot get in"))
			if p.s.tun {
				t = th.Link.Render(p.s.origin)
			}
			r = append(r, row(p.s.tun, a.t("Enlace", "Link"), t))
		}
		ai := a.t("sin configurar", "not configured")
		if p.s.st.LLM {
			ai = a.t("configurada", "configured")
		}
		r = append(r, row(p.s.st.LLM, "IA", ai))
		if p.s.st.Laya != "" && p.s.st.Laya != "off" {
			r = append(r, row(true, "Laya", p.s.st.Laya))
		}
	}
	r = append(r, "")
	if p.note != "" {
		r = append(r, th.Bad.Render(p.note), "")
	}
	if p.state.Remote == "" { // resumen de lo que hay tras la opción elegida
		r = append(r, p.preview(a, p.ch.sel, rw)...)
	} else if inv := rebase(p.state.Invite, p.state.Remote); inv != "" && p.ch.sel == 0 {
		r = append(r, th.label(a.t("Enlace para tus jugadores", "Link for your players")), styled(th.Link, wrap(inv, rw)))
	}
	right := strings.Split(strings.Join(r, "\n"), "\n")
	l := strings.Split(left, "\n")
	var out []string
	for y := 0; y < min(h, max(len(l), len(right))); y++ {
		a1, b1 := "", ""
		if y < len(l) {
			a1 = l[y]
		}
		if y < len(right) {
			b1 = right[y]
		}
		out = append(out, a1+strings.Repeat(" ", max(0, lw-lipgloss.Width(a1)))+" "+th.Rule.Render("│")+"  "+b1)
	}
	return strings.Join(out, "\n")
}

// preview: qué encontrarás al abrir la opción i del menú.
func (p *panel) preview(a *App, i, w int) []string {
	th := a.th
	sec := func(name string, lines ...string) []string {
		out := []string{th.label(name)}
		for _, l := range lines {
			out = append(out, styled(th.Sub, wrap(l, w)))
		}
		return append(out, "", th.Key.Render("[enter]")+" "+th.Muted.Render(a.t("abrir", "open")))
	}
	origin := rebase(p.state.Invite, p.s.origin+p.state.Remote)
	switch i {
	case 0:
		return sec(a.t("Mesas", "Tables"), fmt.Sprintf(a.t("%d mesas en tu servidor.", "%d tables on your server."), p.s.st.Rooms), a.t("Código de la primera mesa: ", "Code of the first table: ")+fmtCode(p.state.Code))
	case 1:
		return sec(a.t("Enlace para tus jugadores", "Link for your players"), origin, a.t("Código de la mesa: ", "Table code: ")+fmtCode(p.state.Code))
	case 2:
		return sec("IA", a.t("Elige otro proveedor, modelo o clave, o quítala.", "Pick another provider, model or key, or remove it."))
	case 3:
		return sec(a.t("Voz", "Voice"), a.t("Qué necesita la voz y cómo está hoy en tu instalación.", "What voice needs and how it stands in your installation."))
	case 4:
		n, last := backupsSummary(a.o.Paths.Backups())
		if n == 0 {
			return sec(a.t("Copias", "Backups"), a.t("Todavía no hay copias guardadas.", "No backups saved yet."))
		}
		return sec(a.t("Copias", "Backups"), fmt.Sprintf(a.t("%d guardadas · la última, el %s.", "%d saved · the latest on %s."), n, last.Format("2006-01-02 15:04")))
	case 5:
		return sec(a.t("Registros", "Logs"), a.t("Lo que ha escrito el servidor y el túnel.", "What the server and the tunnel have written."))
	case 6:
		return sec(a.t("Actualizar", "Update"), a.t("Descarga la última versión y reinicia el servidor (unos segundos sin servicio).", "Downloads the latest version and restarts the server (a few seconds of downtime)."))
	}
	return sec(a.t("Desinstalar", "Uninstall"), a.t("Quita Lantern; tú decides si conservas tus datos.", "Removes Lantern; you decide whether to keep your data."))
}

// rebase cambia el origen (esquema+host) de una URL de invitación al actual.
func rebase(invite, origin string) string {
	if invite == "" || origin == "" {
		return invite
	}
	i, e1 := url.Parse(invite)
	o, e2 := url.Parse(origin)
	if e1 != nil || e2 != nil || o.Host == "" {
		return invite
	}
	i.Scheme, i.Host = o.Scheme, o.Host
	return i.String()
}

func (p *panel) linkScreen(a *App) screen {
	origin := lantern.ReadEnv(a.o.Paths.Env())["LANTERN_ORIGIN"]
	if p.state.Remote != "" {
		origin = p.state.Remote
	}
	inv := rebase(p.state.Invite, origin)
	qr, copied := false, false
	kh := [][2]string{{"c", a.t("copiar enlace y código", "copy link and code")}, {"v", a.t("ver el QR", "show the QR")}}
	if p.state.Tunnel == "quick" {
		kh = append(kh, [2]string{"r", a.t("refrescar el enlace", "refresh the link")})
	}
	keys := map[string]func(*App) tea.Cmd{
		"c": func(a *App) tea.Cmd { copied = true; cmd, _ := copyText(shareText(a, inv, p.state.Code)); return cmd },
		"v": func(*App) tea.Cmd { qr = !qr; return nil }}
	if p.state.Tunnel == "quick" { // el enlace rápido cambia cuando se reinicia el túnel
		st, paths := p.state, a.o.Paths
		keys["r"] = func(a *App) tea.Cmd {
			return a.goTo(newOp(a, a.t("Leyendo el enlace del túnel…", "Reading the tunnel link…"), a.t("Enlace al día.", "Link is up to date."),
				func(ctx context.Context) error { _, err := engine.SyncOrigin(paths, st); return err }, backToPanel))
		}
	}
	return &textScreen{base: base{stagePanel}, keys: keys, kh: append(kh, [2]string{"esc", a.t("atrás", "back")}, [2]string{"q", a.t("salir", "quit")}),
		render: func(a *App, w int) string {
			acts := []string{a.th.Key.Render("[c]") + " " + a.t("Copiar enlace y código", "Copy link and code") + a.th.Done.Render(map[bool]string{true: " ✓", false: ""}[copied])}
			return inviteView(a, a.th.Title.Render(a.t("Enlace de invitación", "Invite link")), inv, p.state.Code, acts, "", w, a.avail(), qr)
		}}
}

// tablesScreen: el servidor no ofrece aún una lista de mesas al instalador, así que se explica lo que hay y dónde se gestionan.
func (p *panel) tablesScreen(a *App) screen {
	origin := p.s.origin + p.state.Remote
	kh := [][2]string{{"esc", a.t("atrás", "back")}, {"q", a.t("salir", "quit")}}
	keys := map[string]func(*App) tea.Cmd{}
	if origin != "" {
		kh = append([][2]string{{"o", a.t("abrir la web", "open the web page")}}, kh...)
		keys["o"] = func(*App) tea.Cmd { _ = platform.OpenURL(origin); return nil }
	}
	return &textScreen{base: base{stagePanel}, kh: kh, keys: keys, render: func(a *App, w int) string {
		return a.th.Title.Render(a.t("Mesas", "Tables")) + "\n\n" +
			wrap(fmt.Sprintf(a.t("Ahora mismo hay %d mesas en tu servidor. Las mesas se crean, editan y archivan desde la web, entrando como DM.", "There are %d tables on your server right now. Tables are created, edited and archived from the web, joining as DM."), p.s.st.Rooms), w) + "\n\n" +
			a.th.label(a.t("Primera mesa", "First table")) + "\n" + a.t("Código: ", "Code: ") + a.th.Title.Render(fmtCode(p.state.Code)) + "\n\n" +
			a.th.Muted.Render(a.t("Para pasar el enlace a tus jugadores, abre «Enlace».", "To send the link to your players, open \"Link\"."))
	}}
}

// voiceScreen: qué necesita la voz y cómo está hoy según el modo instalado.
func (p *panel) voiceScreen(a *App) screen {
	return &textScreen{base: base{stagePanel}, kh: [][2]string{{"esc", a.t("atrás", "back")}, {"q", a.t("salir", "quit")}}, render: func(a *App, w int) string {
		now := a.t("Tu instalación publica un enlace con HTTPS: la voz y el micrófono funcionan desde cualquier navegador.", "Your installation publishes an HTTPS link: voice and microphone work from any browser.")
		if p.state.Mode == "lan" {
			now = a.t("Tu instalación es solo para tu red y va sin HTTPS: el navegador bloquea el micrófono, así que la voz solo funciona en el propio equipo donde corre Lantern.", "Your installation is home-network only and has no HTTPS: the browser blocks the microphone, so voice only works on the machine running Lantern.")
		}
		return a.th.Title.Render(a.t("Voz", "Voice")) + "\n\n" +
			wrap(a.t("La voz y el micrófono necesitan que la mesa se abra por HTTPS. El túnel de Cloudflare y los servidores (Oracle, VPS) lo incluyen.", "Voice and microphone need the table to be opened over HTTPS. The Cloudflare tunnel and the servers (Oracle, VPS) include it."), w) + "\n\n" +
			a.th.label(a.t("Hoy", "Today")) + "\n" + wrap(now, w) + "\n\n" +
			a.th.Muted.Render(wrap(a.t("En Oracle, para la voz hay que abrir además TCP 7881 y UDP 7882 en la «Default Security List».", "On Oracle, voice also needs TCP 7881 and UDP 7882 open in the \"Default Security List\"."), w))
	}}
}

// backupsSummary cuenta las copias del servidor (backups/<mesa>/<fecha>.json) y devuelve la fecha de la más reciente.
func backupsSummary(dir string) (n int, last time.Time) {
	for _, f := range backupFiles(dir) {
		n++
		if f.mod.After(last) {
			last = f.mod
		}
	}
	return
}

type backupFile struct {
	table string
	mod   time.Time
	size  int64
}

func backupFiles(dir string) (out []backupFile) {
	tables, _ := os.ReadDir(dir)
	for _, t := range tables {
		fs, _ := os.ReadDir(filepath.Join(dir, t.Name()))
		for _, f := range fs {
			if i, err := f.Info(); err == nil && strings.HasSuffix(f.Name(), ".json") {
				out = append(out, backupFile{t.Name(), i.ModTime(), i.Size()})
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].mod.After(out[j].mod) })
	return
}

// backupsScreen lista las copias de seguridad que el servidor guarda solo (las últimas 10 de cada mesa).
func (p *panel) backupsScreen(a *App) screen {
	dir := a.o.Paths.Backups()
	return &textScreen{base: base{stagePanel}, kh: [][2]string{{"o", a.t("abrir la carpeta", "open the folder")}, {"↑↓", a.t("desplazar", "scroll")}, {"esc", a.t("atrás", "back")}, {"q", a.t("salir", "quit")}},
		keys: map[string]func(*App) tea.Cmd{"o": func(*App) tea.Cmd { _ = platform.OpenURL(dir); return nil }},
		render: func(a *App, w int) string {
			out := a.th.Title.Render(a.t("Copias de seguridad", "Backups")) + "\n" +
				styled(a.th.Muted, wrap(a.t("El servidor guarda solo copias de cada mesa (las últimas 10) en:", "The server saves copies of each table by itself (the latest 10) in:"), w)) + "\n" + dir + "\n\n"
			fs := backupFiles(dir)
			if len(fs) == 0 {
				return out + a.th.Muted.Render(a.t("Todavía no hay copias guardadas.", "No backups saved yet."))
			}
			out += a.th.label(a.t("Mesa      Fecha              Tamaño", "Table     Date               Size"))
			for _, f := range fs {
				out += fmt.Sprintf("\n%-9s %s  %6.1f KB", fmtCode(f.table), f.mod.Format("2006-01-02 15:04"), float64(f.size)/1024)
			}
			return out
		}}
}

func (p *panel) logsScreen(a *App) screen {
	which := 0
	names := []string{"lantern", "lantern-tunnel"}
	env := lantern.ReadEnv(a.o.Paths.Env())
	s := &textScreen{base: base{stagePanel}, scroll: 1 << 30}
	s.kh = [][2]string{{"tab", a.t("servidor/túnel", "server/tunnel")}, {"r", a.t("recargar", "reload")}, {"↑↓", a.t("desplazar", "scroll")}, {"esc", a.t("atrás", "back")}, {"q", a.t("salir", "quit")}}
	s.render = func(a *App, w int) string {
		b, _ := os.ReadFile(a.o.Paths.Log(names[which]))
		if len(b) > 64<<10 {
			b = b[len(b)-64<<10:]
		}
		t := string(b)
		for _, k := range []string{"LANTERN_ADMIN_TOKEN", "LANTERN_LLM_KEY", "LANTERN_LLM2_KEY"} {
			if v := env[k]; v != "" {
				t = strings.ReplaceAll(t, v, "***")
			}
		}
		lines := strings.Split(strings.TrimRight(t, "\n"), "\n")
		if len(lines) > 400 {
			lines = lines[len(lines)-400:]
		}
		for i := range lines {
			lines[i] = clip(lines[i], w)
		}
		return a.th.Title.Render(names[which]+".log") + "\n" + strings.Join(lines, "\n")
	}
	reload := func(*App) tea.Cmd { s.scroll = 1 << 30; return nil }
	s.keys = map[string]func(*App) tea.Cmd{"r": reload, "tab": func(*App) tea.Cmd { which = 1 - which; s.scroll = 1 << 30; return nil }}
	return s
}

// ---------- operaciones con spinner ----------

type opDone struct{ err error }

type opScreen struct {
	base
	title  string
	run    func(ctx context.Context) error
	after  func(a *App) tea.Cmd // qué hacer tras un éxito al pulsar Enter
	sp     spinner.Model
	done   bool
	err    error
	okText string
}

func (s *opScreen) NoBack() {}
func (s *opScreen) Busy()   {}
func (s *opScreen) Init(a *App) tea.Cmd {
	ctx := a.ctx
	return tea.Batch(s.sp.Tick, func() tea.Msg { return opDone{s.run(ctx)} })
}
func (s *opScreen) Update(a *App, msg tea.Msg) tea.Cmd {
	switch m := msg.(type) {
	case spinner.TickMsg:
		if !s.done {
			var c tea.Cmd
			s.sp, c = s.sp.Update(m)
			return c
		}
	case opDone:
		s.done, s.err = true, m.err
	case tea.KeyPressMsg:
		if s.done && (m.String() == "enter" || m.String() == "esc") {
			if s.err != nil {
				return a.back()
			}
			return s.after(a)
		}
	}
	return nil
}
func (s *opScreen) View(a *App, w, h int) string {
	switch {
	case !s.done:
		return s.sp.View() + " " + s.title
	case s.err != nil:
		return a.th.Bad.Render("✗ "+s.title) + "\n" + wrap(s.err.Error(), w) + "\n\n" + a.th.Muted.Render(a.t("Enter para volver", "Enter to go back"))
	}
	return a.th.Good.Render("✓ "+s.okText) + "\n\n" + a.th.Muted.Render(a.t("Enter para continuar", "Enter to continue"))
}

func newOp(a *App, title, ok string, run func(context.Context) error, after func(*App) tea.Cmd) *opScreen {
	return &opScreen{base: base{stagePanel}, title: title, okText: ok, run: run, after: after, sp: spinner.New(spinner.WithSpinner(spinner.Dot))}
}

func backToPanel(a *App) tea.Cmd { return a.reset(newPanel()) }

func (p *panel) updateScreen(a *App) screen {
	items := []item{{title: a.t("Sí, actualizar ahora", "Yes, update now"), lines: []string{a.t("Descarga la última versión, comprueba que no está dañada y reinicia el servidor (unos segundos sin servicio).", "Downloads the latest version, checks it is not corrupted and restarts the server (a few seconds of downtime).")}}, {title: a.t("Cancelar", "Cancel")}}
	return &menuScreen{base: base{stagePanel}, ch: newChoice(items, 0),
		intro: func(a *App, w int) string { return a.th.Title.Render(a.t("Actualizar Lantern", "Update Lantern")) },
		pick: func(a *App, i int) tea.Cmd {
			if i == 1 {
				return a.back()
			}
			st, paths, cfg := p.state, a.o.Paths, a.cfg
			return a.goTo(newOp(a, a.t("Actualizando…", "Updating…"), a.t("Lantern está actualizado y en marcha.", "Lantern is updated and running."),
				func(ctx context.Context) error { return engine.Update(ctx, paths, st, cfg.ServerBin, cfg.Releases) }, backToPanel))
		}}
}

// changeAI reabre el catálogo de IA (con «Ninguna» se quita) y aplica el resultado.
func (p *panel) changeAI(a *App) tea.Cmd {
	st, paths := p.state, a.o.Paths
	a.cfg.Mode, a.cfg.Tunnel, a.cfg.Domain, a.cfg.Port = st.Mode, st.Tunnel, st.Domain, st.Port
	a.ai = aiFlow{onDone: func(a *App) tea.Cmd {
		cfg := a.cfg
		return a.goTo(newOp(a, a.t("Aplicando la configuración…", "Applying settings…"), a.t("IA actualizada.", "AI updated."), func(ctx context.Context) error {
			env := lantern.ReadEnv(paths.Env())
			cfg.Laya = env["LANTERN_LAYA"] == "1"
			cfg.DataDir = paths.Data
			if err := lantern.WriteEnv(paths.Env(), engine.BuildEnv(cfg, paths, env)); err != nil {
				return err
			}
			return engine.Restart(paths, st)
		}, backToPanel))
	}}
	a.cfg.LLM, a.cfg.LLM2 = nil, nil
	return a.goTo(newProviderScreen(a))
}

func (p *panel) uninstallMenu(a *App) screen {
	items := []item{
		{title: a.t("Quitar el programa y el servicio, conservar mis datos", "Remove the program and service, keep my data"), lines: []string{a.t("Se conservan lantern.db, imágenes y copias en "+a.o.Paths.Data, "lantern.db, images and backups in "+a.o.Paths.Data+" are kept")}},
		{title: a.t("Quitar TODO, incluidas mis mesas y datos", "Remove EVERYTHING, including my tables and data"), lines: []string{a.t("No se puede deshacer.", "This cannot be undone.")}},
		{title: a.t("Cancelar", "Cancel")},
	}
	return &menuScreen{base: base{stagePanel}, ch: newChoice(items, 2),
		intro: func(a *App, w int) string { return a.th.Title.Render(a.t("Desinstalar Lantern", "Uninstall Lantern")) },
		pick: func(a *App, i int) tea.Cmd {
			st, paths := p.state, a.o.Paths
			quit := func(*App) tea.Cmd { return tea.Quit }
			switch i {
			case 0:
				return a.goTo(newOp(a, a.t("Desinstalando…", "Uninstalling…"), a.t("Lantern se ha desinstalado; tus datos siguen en "+paths.Data, "Lantern is uninstalled; your data remains in "+paths.Data),
					func(ctx context.Context) error { return engine.Uninstall(paths, st, false) }, quit))
			case 1:
				word := a.t("BORRAR", "DELETE")
				var typed string
				f := huh.NewForm(huh.NewGroup(huh.NewInput().Title(a.t("Escribe "+word+" para confirmar", "Type "+word+" to confirm")).Value(&typed).
					Validate(func(s string) error {
						if strings.TrimSpace(s) != word {
							return fmt.Errorf("%s", a.t("escribe exactamente "+word, "type exactly "+word))
						}
						return nil
					})))
				return a.goTo(newForm(a, -1, a.t("Se borrarán todas tus mesas, mapas y ajustes de "+paths.Data+".", "All your tables, maps and settings in "+paths.Data+" will be deleted."), f, func(a *App) tea.Cmd {
					return a.goTo(newOp(a, a.t("Borrando todo…", "Deleting everything…"), a.t("Lantern y todos sus datos se han eliminado.", "Lantern and all its data have been removed."),
						func(ctx context.Context) error { return engine.Uninstall(paths, st, true) }, quit))
				}))
			}
			return a.back()
		}}
}

var _ = platform.Paths{}
