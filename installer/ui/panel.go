package ui

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"charm.land/bubbles/v2/spinner"
	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"

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

func newPanel() *panel { return &panel{base: base{-1}} }

func (p *panel) Init(a *App) tea.Cmd {
	p.state, p.loaded = engine.LoadState(a.o.Paths)
	if p.state.Lang != "" && a.cfg.Lang == "" {
		a.cfg.Lang = p.state.Lang
	}
	remote := p.state.Remote != ""
	items := []item{
		{title: a.t("Enlace y QR", "Link and QR")}, {title: a.t("Registros", "Logs")},
		{title: a.t("Cambiar configuración", "Change settings")}, {title: a.t("Actualizar Lantern", "Update Lantern")},
		{title: a.t("Desinstalar", "Uninstall")}, {title: a.t("Salir", "Quit")},
	}
	if remote {
		items = []item{{title: a.t("Enlace y QR", "Link and QR")}, {title: a.t("Olvidar esta instalación (el servidor remoto no se toca)", "Forget this installation (the remote server is untouched)")}, {title: a.t("Salir", "Quit")}}
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
		return nil
	case tickMsg:
		return tea.Batch(p.refresh(a), tick())
	}
	if !p.ch.update(msg) {
		if k, ok := msg.(tea.KeyPressMsg); ok && k.String() == "q" {
			a.quitting = true
			return tea.Quit
		}
		return nil
	}
	if p.state.Remote != "" {
		switch p.ch.sel {
		case 0:
			return a.goTo(p.linkScreen(a))
		case 1:
			_ = os.Remove(a.o.Paths.Data + "/state.json")
			return tea.Quit
		}
		return tea.Quit
	}
	switch p.ch.sel {
	case 0:
		return a.goTo(p.linkScreen(a))
	case 1:
		return a.goTo(p.logsScreen(a))
	case 2:
		return a.goTo(p.configMenu(a))
	case 3:
		return a.goTo(p.updateScreen(a))
	case 4:
		return a.goTo(p.uninstallMenu(a))
	}
	return tea.Quit
}

func dot(a *App, on bool) string {
	if on {
		return a.th.Good.Render("●")
	}
	return a.th.Bad.Render("○")
}

func (p *panel) Help(a *App) string {
	return a.t("Aquí ves si Lantern, el túnel y la IA están funcionando. Desde el menú puedes ver el enlace, los registros, cambiar la IA, actualizar o desinstalar.", "Here you see whether Lantern, the tunnel and the AI are running. From the menu you can see the link, logs, change the AI, update or uninstall.")
}

func (p *panel) View(a *App, w, h int) string {
	var b strings.Builder
	if !p.loaded {
		return a.th.Bad.Render(a.t("No encuentro ninguna instalación en ", "No installation found in ") + a.o.Paths.Data)
	}
	b.WriteString(a.th.Title.Render(a.t("Estado", "Status")) + "\n")
	if p.state.Remote != "" {
		b.WriteString(fmt.Sprintf("  %s %s  %s\n", dot(a, true), a.t("Servidor remoto", "Remote server"), a.th.Link.Render(p.state.Remote)))
		b.WriteString(a.th.Muted.Render("  "+a.t("Se gestiona por SSH en el propio servidor.", "Managed over SSH on the server itself.")) + "\n\n")
	} else {
		info := a.t("parado", "stopped")
		if p.s.srv {
			info = a.t("en marcha", "running")
			if p.s.st.Version != "" {
				info += " · v" + p.s.st.Version + fmt.Sprintf(a.t(" · %d mesas", " · %d tables"), p.s.st.Rooms)
			}
			if p.s.err != nil {
				info += " · " + a.t("sin respuesta del admin", "admin not responding")
			}
		}
		b.WriteString(fmt.Sprintf("  %s %-10s %s\n", dot(a, p.s.srv), a.t("Lantern", "Lantern"), info))
		if p.state.Tunnel != "none" && p.state.Tunnel != "" {
			t := a.t("caído: tus jugadores no pueden entrar", "down: your players cannot get in")
			if p.s.tun {
				t = a.t("activo ", "active ") + a.th.Link.Render(p.s.origin)
			}
			b.WriteString(fmt.Sprintf("  %s %-10s %s\n", dot(a, p.s.tun), a.t("Enlace", "Link"), t))
		}
		ai := a.t("sin configurar", "not configured")
		if p.s.st.LLM {
			ai = a.t("configurada", "configured")
		}
		if p.s.st.Laya != "" && p.s.st.Laya != "off" {
			ai += " · Laya " + p.s.st.Laya
		}
		b.WriteString(fmt.Sprintf("  %s %-10s %s\n\n", dot(a, p.s.st.LLM || (p.s.st.Laya != "" && p.s.st.Laya != "off")), "IA", ai))
	}
	if inv := rebase(p.state.Invite, p.s.origin+p.state.Remote); inv != "" { // un solo origen: el del túnel o el del servidor remoto
		b.WriteString(a.th.Accent.Render(a.t("Enlace para tus jugadores", "Link for your players")) + "\n" + styled(a.th.Link, wrap(inv, w)) + "\n" +
			a.th.Muted.Render(a.t("Código de la mesa  ", "Table code  ")) + a.th.Title.Render(p.state.Code) + "\n\n")
	}
	if p.note != "" {
		b.WriteString(a.th.Accent.Render(p.note) + "\n\n")
	}
	p.ch.Y0 = strings.Count(b.String(), "\n")
	b.WriteString(p.ch.view(a.th, w, h-p.ch.Y0-1, true))
	return b.String()
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
	return &textScreen{base: base{-1},
		keys: map[string]func(*App) tea.Cmd{
			"c": func(a *App) tea.Cmd { copied = true; cmd, _ := copyText(inv); return cmd },
			"v": func(*App) tea.Cmd { qr = !qr; return nil }},
		render: func(a *App, w int) string {
			acts := []string{a.th.Key.Render("c") + " " + a.t("copiar el enlace", "copy the link") + map[bool]string{true: " ✓", false: ""}[copied],
				a.th.Key.Render("Esc") + " " + a.t("volver", "back")}
			return inviteView(a, a.t("Enlace de invitación", "Invite link"), inv, p.state.Code, acts, "", w, a.avail(), qr)
		}}
}

func (p *panel) logsScreen(a *App) screen {
	which := 0
	names := []string{"lantern", "lantern-tunnel"}
	env := lantern.ReadEnv(a.o.Paths.Env())
	s := &textScreen{base: base{-1}, scroll: 1 << 30}
	s.hint = a.th.Muted.Render(a.t("Tab cambia servidor/túnel · r recarga · Esc volver", "Tab switches server/tunnel · r reload · Esc back"))
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
	return &opScreen{base: base{-1}, title: title, okText: ok, run: run, after: after, sp: spinner.New(spinner.WithSpinner(spinner.Dot))}
}

func backToPanel(a *App) tea.Cmd { return a.reset(newPanel()) }

func (p *panel) updateScreen(a *App) screen {
	items := []item{{title: a.t("Sí, actualizar ahora", "Yes, update now"), lines: []string{a.t("Descarga la última versión, comprueba que no está dañada y reinicia el servidor (unos segundos sin servicio).", "Downloads the latest version, checks it is not corrupted and restarts the server (a few seconds of downtime).")}}, {title: a.t("Cancelar", "Cancel")}}
	return &menuScreen{base: base{-1}, ch: newChoice(items, 0), numbered: true,
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

func (p *panel) configMenu(a *App) screen {
	items := []item{
		{title: a.t("Cambiar o quitar la IA", "Change or remove the AI"), lines: []string{a.t("Elige otro proveedor, modelo o clave.", "Pick another provider, model or key.")}},
		{title: a.t("Refrescar el enlace rápido", "Refresh the quick link"), lines: []string{a.t("Lee el enlace actual del túnel y reinicia el servidor si cambió.", "Reads the tunnel's current link and restarts the server if it changed.")}},
		{title: a.t("Repetir el asistente completo", "Run the full assistant again"), lines: []string{a.t("Vuelve a preguntar todo (conserva tus datos y mesas).", "Asks everything again (keeps your data and tables).")}},
	}
	return &menuScreen{base: base{-1}, ch: newChoice(items, 0), numbered: true,
		intro: func(a *App, w int) string { return a.th.Title.Render(a.t("Cambiar configuración", "Change settings")) },
		pick: func(a *App, i int) tea.Cmd {
			st, paths := p.state, a.o.Paths
			switch i {
			case 0:
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
				return a.goTo(aiIntro(a))
			case 1:
				return a.goTo(newOp(a, a.t("Leyendo el enlace del túnel…", "Reading the tunnel link…"), a.t("Enlace al día.", "Link is up to date."),
					func(ctx context.Context) error { _, err := engine.SyncOrigin(paths, st); return err }, backToPanel))
			}
			a.o.Panel = false
			return a.reset(newWelcome(a))
		}}
}

func (p *panel) uninstallMenu(a *App) screen {
	items := []item{
		{title: a.t("Quitar el programa y el servicio, conservar mis datos", "Remove the program and service, keep my data"), lines: []string{a.t("Se conservan lantern.db, imágenes y copias en "+a.o.Paths.Data, "lantern.db, images and backups in "+a.o.Paths.Data+" are kept")}},
		{title: a.t("Quitar TODO, incluidas mis mesas y datos", "Remove EVERYTHING, including my tables and data"), lines: []string{a.t("No se puede deshacer.", "This cannot be undone.")}},
		{title: a.t("Cancelar", "Cancel")},
	}
	return &menuScreen{base: base{-1}, ch: newChoice(items, 2), numbered: true,
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
