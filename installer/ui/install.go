package ui

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"charm.land/bubbles/v2/progress"
	"charm.land/bubbles/v2/spinner"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"lantern/installer/docker"
	"lantern/installer/engine"
	"lantern/installer/lantern"
	"lantern/installer/model"
	"lantern/installer/platform"
	"lantern/installer/remote"
)

type progMsg struct {
	step int
	text string
}
type doneMsg struct {
	res  model.Result
	err  error
	text string // texto libre para el modo Docker
}

type installScreen struct {
	base
	steps  []engine.Step
	cur    int
	logs   []string
	sp     spinner.Model
	bar    progress.Model
	ch     chan tea.Msg
	cancel context.CancelFunc
	err    error
	retry  *choice
	secret []string
}

func (s *installScreen) NoBack() {}

func newInstallScreen(a *App) *installScreen {
	s := &installScreen{base: base{5}, sp: spinner.New(spinner.WithSpinner(spinner.Dot)), bar: progress.New(progress.WithWidth(40), progress.WithoutPercentage()), ch: make(chan tea.Msg, 64)}
	c := a.cfg
	switch {
	case c.Docker:
		s.steps = []engine.Step{{ID: "docker", ES: "Generando docker-compose.yml y lantern.env", EN: "Generating docker-compose.yml and lantern.env"}}
	case c.Mode == "oracle" || c.Mode == "vps":
		s.steps = []engine.Step{{ID: "key", ES: "Preparando la clave SSH", EN: "Preparing the SSH key"}, {ID: "deploy", ES: "Desplegando en el servidor (unos minutos)", EN: "Deploying to the server (a few minutes)"}}
	default:
		s.steps = engine.Plan(c)
	}
	for _, x := range []string{c.CloudToken, c.SSHKeyPath} {
		if x != "" {
			s.secret = append(s.secret, x)
		}
	}
	for _, l := range []*model.LLM{c.LLM, c.LLM2} {
		if l != nil && l.Key != "" {
			s.secret = append(s.secret, l.Key)
		}
	}
	return s
}

func (s *installScreen) Init(a *App) tea.Cmd {
	s.err, s.retry, s.cur, s.logs = nil, nil, 0, nil
	ctx, cancel := context.WithCancel(a.ctx)
	s.cancel = cancel
	cfg, ch := a.cfg, s.ch
	dep := a.o.Deployers[cfg.Mode]
	go func() {
		prog := func(i int, m string) { ch <- progMsg{i, m} }
		var res model.Result
		var err error
		var text string
		switch {
		case cfg.Docker:
			text, err = writeDocker(cfg)
		case cfg.Mode == "oracle" || cfg.Mode == "vps":
			prog(0, "")
			if cfg.SSHKeyPath == "" {
				cfg.SSHKeyPath, _, err = remote.EnsureKey(cfg.DataDir)
			}
			if err == nil {
				prog(1, "")
				res, err = dep.Deploy(ctx, cfg, func(l string) { prog(1, l) })
			}
			if err == nil {
				origin := res.Origin
				err = engine.SaveState(platform.Paths{Data: cfg.DataDir}, engine.State{Lang: cfg.Lang, Mode: cfg.Mode, Tunnel: "none", Domain: cfg.Domain, Port: cfg.Port, Code: res.Code, Invite: res.InviteURL, Remote: origin})
			}
		default:
			res, err = engine.Run(ctx, cfg, prog)
		}
		ch <- doneMsg{res, err, text}
	}()
	return tea.Batch(s.sp.Tick, s.wait())
}

func (s *installScreen) wait() tea.Cmd { ch := s.ch; return func() tea.Msg { return <-ch } }

func (s *installScreen) redact(t string) string {
	for _, x := range s.secret {
		t = strings.ReplaceAll(t, x, "***")
	}
	return t
}

func (s *installScreen) Update(a *App, msg tea.Msg) tea.Cmd {
	switch m := msg.(type) {
	case spinner.TickMsg:
		var c tea.Cmd
		s.sp, c = s.sp.Update(m)
		return c
	case progMsg:
		s.cur = max(s.cur, min(m.step, len(s.steps)-1))
		if m.text != "" {
			s.logs = append(s.logs, s.redact(m.text))
			if len(s.logs) > 300 {
				s.logs = s.logs[1:]
			}
		}
		return s.wait()
	case doneMsg:
		if m.err != nil {
			s.err = m.err
			s.retry = newChoice([]item{{title: a.t("Reintentar", "Retry")}, {title: a.t("Volver y cambiar respuestas", "Go back and change answers")}, {title: a.t("Salir", "Quit")}}, 0)
			return nil
		}
		a.result = m.res
		return a.reset(newDone(a, m.text))
	}
	if s.err != nil && s.retry.update(msg) {
		switch s.retry.sel {
		case 0:
			return s.Init(a)
		case 1:
			if c := a.back(); c != nil {
				return c
			}
			return nil
		}
		return tea.Quit
	}
	return nil
}

func (s *installScreen) View(a *App, w, h int) string {
	var b strings.Builder
	b.WriteString(a.th.Title.Render(a.t("Instalando", "Installing")) + "\n\n")
	for i, st := range s.steps {
		txt := a.pick2(st.ES, st.EN)
		switch {
		case s.err != nil && i == s.cur:
			b.WriteString(a.th.Bad.Render("  ✗ "+txt) + "\n")
		case i < s.cur:
			b.WriteString(a.th.Done.Render("  ✓ ") + a.th.Sub.Render(txt) + "\n")
		case i == s.cur:
			b.WriteString("  " + s.sp.View() + " " + a.th.Cur.Render(txt) + "\n")
		default:
			b.WriteString(a.th.Todo.Render("  ○ "+txt) + "\n")
		}
	}
	b.WriteString("\n  " + s.bar.ViewAs(float64(s.cur)/float64(len(s.steps))) + "\n\n")
	room := max(2, h-len(s.steps)-9)
	if s.err != nil {
		msg := s.redact(s.err.Error())
		b.WriteString(a.th.Bad.Render(a.t("Algo falló:", "Something failed:")) + "\n" + wrap(msg, w) + "\n")
		b.WriteString(a.th.Muted.Render(a.t("Puedes reintentar; lo que ya se instaló se reutiliza.", "You can retry; what is already installed is reused.")) + "\n\n")
		s.retry.Y0 = strings.Count(b.String(), "\n") + 0
		b.WriteString(s.retry.view(a.th, w, 4, true))
		return b.String()
	}
	logs := s.logs
	if len(logs) > room {
		logs = logs[len(logs)-room:]
	}
	for _, l := range logs {
		b.WriteString(a.th.Muted.Render("  "+clip(l, w-4)) + "\n")
	}
	return b.String()
}

func (s *installScreen) Help(a *App) string {
	return a.t("Todo se hace solo. Si algo falla verás qué hacer y podrás reintentar. Ctrl+C cancela.", "Everything runs by itself. If something fails you will see what to do and can retry. Ctrl+C cancels.")
}

// writeDocker genera docker-compose.yml y lantern.env en DataDir/docker.
func writeDocker(c model.Config) (string, error) {
	dir := filepath.Join(c.DataDir, "docker")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	p := platform.Paths{Data: c.DataDir}
	env := engine.BuildEnv(c, p, lantern.ReadEnv(filepath.Join(dir, "lantern.env")))
	for _, k := range []string{"PORT", "HOST", "LANTERN_DB", "LANTERN_ASSETS", "LANTERN_BACKUP_DIR", "LANTERN_ORIGIN"} {
		delete(env, k) // rutas del anfitrión: dentro del contenedor las fija la imagen
	}
	if err := lantern.WriteEnv(filepath.Join(dir, "lantern.env"), env); err != nil {
		return "", err
	}
	port := c.Port
	if port == 0 {
		port = engine.DefaultPort
	}
	compose := docker.Compose(docker.Options{Image: "ghcr.io/lantern-vtt/lantern:latest", Port: port})
	if err := os.WriteFile(filepath.Join(dir, "docker-compose.yml"), []byte(compose), 0o644); err != nil {
		return "", err
	}
	lang := "es"
	if c.Lang == "en" {
		lang = "en"
	}
	return dir + "\n\n" + docker.NASInstructions(lang), nil
}

// ---------- Listo ----------

type doneScreen struct {
	base
	text   string
	copied bool
}

func newDone(a *App, text string) *doneScreen { return &doneScreen{base: base{6}, text: text} }

func (s *doneScreen) NoBack() {}

func (a *App) inviteURL() string {
	if a.result.InviteURL != "" {
		return a.result.InviteURL
	}
	return ""
}

func (s *doneScreen) Update(a *App, msg tea.Msg) tea.Cmd {
	if k, ok := msg.(tea.KeyPressMsg); ok {
		switch k.String() {
		case "o":
			if a.result.DMURL != "" {
				_ = platform.OpenURL(a.result.DMURL)
			}
		case "c":
			if u := a.inviteURL(); u != "" {
				s.copied = true
				return tea.SetClipboard(u)
			}
		case "p":
			if a.cfg.Docker {
				return nil
			}
			return a.reset(newPanel())
		case "enter", "q":
			a.quitting = true
			return tea.Quit
		}
	}
	return nil
}

func (s *doneScreen) Help(a *App) string {
	return a.t("Comparte el enlace de invitación y el código con tus jugadores. «o» te abre la mesa como DM en el navegador. Para volver a este panel, ejecuta «lantern» otra vez.", "Share the invite link and code with your players. “o” opens the table as DM in the browser. To return to this dashboard, run “lantern” again.")
}

func (s *doneScreen) View(a *App, w, h int) string {
	if a.cfg.Docker {
		return a.th.Title.Render(a.t("Archivos listos para tu NAS", "Files ready for your NAS")) + "\n\n" + wrap(s.text, w) + "\n\n" + a.th.Muted.Render(a.t("Enter para salir", "Enter to quit"))
	}
	inv := a.inviteURL()
	left := []string{a.th.Title.Render("✓ " + a.t("Lantern está listo", "Lantern is ready")), "",
		a.th.Accent.Render(a.t("Enlace de invitación", "Invite link")), a.th.Link.Render(inv), "",
		a.th.Accent.Render(a.t("Código de la mesa", "Table code")) + "  " + a.th.Title.Render(a.result.Code), ""}
	if a.cfg.Tunnel == "quick" {
		left = append(left, wrap(a.th.Muted.Render(a.t("Este enlace rápido cambia si el túnel se reinicia; el panel lo actualiza y te da el nuevo.", "This quick link changes if the tunnel restarts; the dashboard refreshes it and shows the new one.")), w/2+8), "")
	}
	left = append(left, a.th.Key.Render("o")+" "+a.t("abrir la mesa como DM en el navegador", "open the table as DM in the browser"),
		a.th.Key.Render("c")+" "+a.t("copiar el enlace", "copy the link")+map[bool]string{true: " ✓", false: ""}[s.copied],
		a.th.Key.Render("p")+" "+a.t("abrir el panel", "open the dashboard"),
		a.th.Key.Render("Enter")+" "+a.t("salir", "quit"), "",
		a.th.Muted.Render(a.t("Para volver aquí más tarde ejecuta «lantern»: estado, registros, actualizar y desinstalar.", "To come back later run “lantern”: status, logs, update and uninstall.")))
	txt := strings.Join(left, "\n")
	if inv == "" {
		return txt
	}
	q := renderQR(inv, a.th.mono, a.th.dark)
	if w < 70 || strings.Count(q, "\n")+1 > h {
		return txt
	}
	return lipgloss.JoinHorizontal(lipgloss.Top, lipgloss.NewStyle().Width(w-lipgloss.Width(q)-4).Render(txt), "   ", q)
}
