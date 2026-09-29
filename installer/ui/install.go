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
	"github.com/charmbracelet/x/ansi"

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
	if s.err == nil {
		b.WriteString("\n  " + s.bar.ViewAs(float64(s.cur)/float64(len(s.steps))) + "\n\n")
	} else {
		b.WriteString("\n")
	}
	room := max(2, h-len(s.steps)-9)
	if s.err != nil {
		msg := s.redact(s.err.Error())
		b.WriteString(a.th.Bad.Render(a.t("Algo falló:", "Something failed:")) + "\n" + wrap(msg, w) + "\n")
		b.WriteString(a.th.Muted.Render(a.t("Puedes reintentar; lo que ya se instaló se reutiliza.", "You can retry; what is already installed is reused.")) + "\n\n")
		s.retry.Y0 = strings.Count(b.String(), "\n") + 0
		b.WriteString(s.retry.view(a.th, w, max(3, h-strings.Count(b.String(), "\n")), true))
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
	compose := docker.Compose(docker.Options{Image: lantern.DefaultImage + ":latest", Port: port})
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
	qr     bool // se muestra solo el QR (cuando no cabe junto al texto)
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
		case "esc":
			s.qr = false
		case "v":
			s.qr = !s.qr
		case "o", "enter":
			if k.String() == "enter" && a.cfg.Docker {
				a.quitting = true
				return tea.Quit
			}
			if a.cfg.Docker {
				dir, _, _ := strings.Cut(s.text, "\n\n")
				_ = platform.OpenURL(dir)
			} else if a.result.DMURL != "" {
				_ = platform.OpenURL(a.result.DMURL)
			}
		case "c":
			if u := a.inviteURL(); u != "" {
				s.copied = true
				cmd, _ := copyText(u)
				return cmd
			}
		case "p":
			if a.cfg.Docker {
				return nil
			}
			return a.reset(newPanel())
		case "q":
			a.quitting = true
			return tea.Quit
		}
	}
	return nil
}

func (s *doneScreen) Help(a *App) string {
	return a.t("Comparte el enlace de invitación y el código con tus jugadores: pueden escribirlo o escanear el QR con el móvil. Enter o «o» te abre la mesa como DM (director de juego) en el navegador. Para volver a este panel, ejecuta «lantern» otra vez.", "Share the invite link and code with your players: they can type it or scan the QR with a phone. Enter or \"o\" opens the table as DM (game master) in the browser. To return to this dashboard, run \"lantern\" again.")
}

func (s *doneScreen) View(a *App, w, h int) string {
	if a.cfg.Docker {
		dir, rest, _ := strings.Cut(s.text, "\n\n")
		return a.th.Title.Render("✓ "+a.t("Archivos listos para tu NAS", "Files ready for your NAS")) + "\n\n" +
			wrap(a.t("He creado «docker-compose.yml» y «lantern.env» en:", "I created \"docker-compose.yml\" and \"lantern.env\" in:"), w) + "\n" + a.th.Link.Render(dir) + "\n\n" +
			wrap(a.t("Súbelos a tu NAS y sigue los pasos de tu modelo:", "Upload them to your NAS and follow the steps for your model:"), w) + "\n" + wrap(rest, w) + "\n\n" +
			a.th.Key.Render("o") + " " + a.th.Muted.Render(a.t("abrir la carpeta · ", "open the folder · ")) + a.th.Key.Render("Enter") + " " + a.th.Muted.Render(a.t("salir", "quit"))
	}
	acts := []string{a.th.Key.Render("Enter") + " " + a.t("abrir la mesa como DM en el navegador", "open the table as DM in the browser"),
		a.th.Key.Render("c") + " " + a.t("copiar el enlace", "copy the link") + map[bool]string{true: " ✓", false: ""}[s.copied],
		a.th.Key.Render("p") + " " + a.t("abrir el panel", "open the dashboard"),
		a.th.Key.Render("q") + " " + a.t("salir", "quit")}
	foot := a.th.Muted.Render(a.t("Para volver aquí más tarde ejecuta «lantern»: estado, registros, actualizar y desinstalar.", "To come back later run \"lantern\": status, logs, update and uninstall."))
	return inviteView(a, "✓ "+a.t("Lantern está listo", "Lantern is ready"), a.inviteURL(), a.result.Code, acts, foot, w, h, s.qr)
}

// inviteView: enlace, código y acciones a la izquierda y el QR a la derecha. Si no cabe, se ofrece con la tecla «v».
func inviteView(a *App, title, inv, code string, acts []string, foot string, w, h int, onlyQR bool) string {
	if inv == "" {
		return a.th.Title.Render(title) + "\n\n" + wrap(a.t("Aún no hay enlace: el servidor no está publicado.", "No link yet: the server is not published."), w)
	}
	q := renderQR(inv, a.th.mono, a.th.dark)
	qw, qh := lipgloss.Width(q), strings.Count(q, "\n")+1
	if onlyQR {
		if qh > h || qw > w {
			return a.th.Bad.Render(wrap(a.t("Este QR no cabe en la ventana. Agranda el terminal (o reduce la letra) y vuelve a pulsar «v».", "This QR does not fit the window. Enlarge the terminal (or reduce the font) and press \"v\" again."), w)) + "\n\n" + a.th.Key.Render("v") + " " + a.th.Muted.Render(a.t("volver", "back"))
		}
		if qh == h { // sin sitio para la leyenda
			return q
		}
		return q + "\n" + a.th.Muted.Render(a.t("Escanéalo con la cámara del móvil · ", "Scan it with the phone camera · ")) + a.th.Key.Render("v") + " " + a.th.Muted.Render(a.t("volver", "back"))
	}
	side := w >= qw+3+36 && qh <= h
	lw := w
	if side {
		lw = w - qw - 3
	}
	if !side {
		acts = append([]string{acts[0]}, append([]string{a.th.Key.Render("v") + " " + a.t("ver el QR para escanear con el móvil", "show the QR to scan with a phone")}, acts[1:]...)...)
	}
	build := func(level int) string { // 0 completo; 1 sin la nota final; 2 además sin líneas en blanco ni aviso del túnel
		left := []string{a.th.Title.Render(title), "",
			a.th.Accent.Render(a.t("Enlace para tus jugadores", "Link for your players")), styled(a.th.Link, wrap(inv, lw)), "",
			a.th.Accent.Render(a.t("Código de la mesa", "Table code")) + "  " + a.th.Title.Render(code), ""}
		if a.cfg.Tunnel == "quick" && level < 2 {
			left = append(left, styled(a.th.Muted, wrap(a.t("Este enlace es temporal: cambia si el túnel se reinicia. El panel te dará el nuevo.", "This link is temporary: it changes if the tunnel restarts. The dashboard will give you the new one."), lw)), "")
		}
		for _, x := range acts {
			left = append(left, wrap(x, lw))
		}
		if foot != "" && level < 1 {
			left = append(left, "", styled(a.th.Muted, wrap(ansi.Strip(foot), lw)))
		}
		if level == 2 {
			var l2 []string
			for _, l := range left {
				if l != "" {
					l2 = append(l2, l)
				}
			}
			left = l2
		}
		return strings.Join(left, "\n")
	}
	txt := build(0)
	for lv := 1; lv <= 2 && strings.Count(txt, "\n")+1 > h; lv++ {
		txt = build(lv)
	}
	if !side {
		return txt
	}
	return lipgloss.JoinHorizontal(lipgloss.Top, lipgloss.NewStyle().Width(lw).Render(txt), "   ", q)
}
