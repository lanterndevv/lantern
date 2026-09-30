package ui

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

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
	t0     time.Time       // inicio del paso actual
	durs   []time.Duration // lo que tardó cada paso terminado
	full   bool            // el registro ocupa toda la pantalla
	ch     chan tea.Msg
	cancel context.CancelFunc
	err    error
	retry  *choice
	secret []string
}

func (s *installScreen) NoBack() {}
func (s *installScreen) Busy()   {}

func newInstallScreen(a *App) *installScreen {
	s := &installScreen{base: base{5}, sp: spinner.New(spinner.WithSpinner(spinner.Dot)), ch: make(chan tea.Msg, 64)}
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
	s.err, s.retry, s.cur, s.logs, s.t0, s.durs = nil, nil, 0, nil, time.Now(), make([]time.Duration, len(s.steps))
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
		if n := min(m.step, len(s.steps)-1); n > s.cur {
			s.durs[s.cur], s.cur, s.t0 = time.Since(s.t0), n, time.Now()
		}
		if m.text != "" {
			s.logs = append(s.logs, time.Now().Format("15:04:05")+"  "+s.redact(m.text))
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
	if k, ok := msg.(tea.KeyPressMsg); ok && s.err == nil {
		switch k.String() {
		case "l":
			s.full = !s.full
		case "esc": // cancelar la instalación
			a.cancel()
			a.quitting = true
			return tea.Quit
		}
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

func (s *installScreen) Keys(a *App) [][2]string {
	if s.err != nil {
		return [][2]string{{"↑↓", a.t("elegir", "move")}, {"enter", a.t("continuar", "continue")}, {"q", a.t("salir", "quit")}}
	}
	return [][2]string{{"l", a.t("registro completo", "full log")}, {"esc", a.t("cancelar", "cancel")}, {"?", a.t("ayuda", "help")}, {"", a.t("se instala en segundo plano", "installing in the background")}}
}

func (s *installScreen) View(a *App, w, h int) string {
	th := a.th
	var b strings.Builder
	logBox := func(room int) string { // las últimas líneas; la más reciente, resaltada
		logs := s.logs
		if len(logs) > room {
			logs = logs[len(logs)-room:]
		}
		out := make([]string, room-len(logs), room)
		for i, l := range logs {
			st := th.Muted
			if i == len(logs)-1 {
				st = th.Sub
			}
			out = append(out, st.Render(clip(l, w-6)))
		}
		return th.box(strings.Join(out, "\n"), w-2)
	}
	if s.full && s.err == nil {
		return th.label(a.t("Registro", "Log")) + "\n" + logBox(max(1, h-5)) + "\n\n" + th.Key.Render("[l]") + " " + a.t("volver a los pasos", "back to the steps")
	}
	b.WriteString(th.Title.Render(a.t("Instalando tu mesa…", "Installing your table…")) + "\n")
	b.WriteString(th.Muted.Render(a.t("Puedes dejarlo solo: te avisamos al terminar.", "You can leave it alone: we will tell you when it is done.")) + "\n\n")
	nw := 0
	for _, st := range s.steps {
		nw = max(nw, lipgloss.Width(a.pick2(st.ES, st.EN)))
	}
	nw = min(nw+3, w/2+6)
	for i, st := range s.steps {
		txt := clip(a.pick2(st.ES, st.EN), nw-3)
		pad := strings.Repeat(" ", max(1, nw-lipgloss.Width(txt)))
		switch {
		case s.err != nil && i == s.cur:
			b.WriteString(th.Bad.Render("✗  "+txt) + "\n")
		case i < s.cur:
			b.WriteString(th.Done.Render("✓  ") + th.Sub.Render(txt) + pad + th.Muted.Render(clip(fmtDur(s.durs[i]), w-nw-3)) + "\n")
		case i == s.cur:
			detail := ""
			if n := len(s.logs); n > 0 {
				detail = strings.TrimSpace(s.logs[n-1][min(len(s.logs[n-1]), 10):])
			}
			b.WriteString(strings.TrimSpace(s.sp.View()) + "  " + th.Cur.Render(txt) + pad + th.Muted.Render(clip(detail, w-nw-3)) + "\n")
		default:
			b.WriteString(th.Todo.Render("○  "+txt) + "\n")
		}
	}
	if s.err != nil {
		b.WriteString("\n")
		msg := s.redact(s.err.Error())
		b.WriteString(th.Bad.Render(a.t("Algo falló:", "Something failed:")) + "\n" + wrap(msg, w) + "\n")
		b.WriteString(th.Muted.Render(a.t("Puedes reintentar; lo que ya se instaló se reutiliza.", "You can retry; what is already installed is reused.")) + "\n\n")
		s.retry.Y0 = strings.Count(b.String(), "\n") + 0
		b.WriteString(s.retry.view(th, w, max(3, h-strings.Count(b.String(), "\n")), true))
		return b.String()
	}
	b.WriteString("\n" + th.label(a.t("En total", "Overall")) + "  " + th.bar(float64(s.cur)/float64(len(s.steps)), 36) + th.Muted.Render(fmt.Sprintf(a.t("  %d de %d", "  %d of %d"), s.cur, len(s.steps))) + "\n")
	if room := h - len(s.steps) - 10; room >= 1 { // sin sitio para el registro, se ve con «l»
		b.WriteString("\n" + th.label(a.t("Registro", "Log")) + "\n" + logBox(min(room, 5)) + "\n")
	}
	b.WriteString("\n" + th.Key.Render("[l]") + " " + a.t("ver el registro completo", "see the full log") + "     " + th.Key.Render("[esc]") + " " + a.t("cancelar la instalación", "cancel the installation"))
	return b.String()
}

// fmtDur: «6 s», «1 min 12 s».
func fmtDur(d time.Duration) string {
	sec := int(d.Seconds() + 0.5)
	if sec < 60 {
		return fmt.Sprintf("%d s", sec)
	}
	return fmt.Sprintf("%d min %d s", sec/60, sec%60)
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
	for _, k := range []string{"PORT", "HOST", "TRUST_PROXY", "LANTERN_DB", "LANTERN_ASSETS", "LANTERN_BACKUP_DIR", "LANTERN_ORIGIN"} {
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
				cmd, _ := copyText(shareText(a, u, a.result.Code))
				return cmd
			}
		case "p":
			if a.cfg.Docker {
				return nil
			}
			return a.reset(newPanel())
		}
	}
	return nil
}

// shareText es lo que se copia para pasar a los jugadores: el enlace y el código.
func shareText(a *App, inv, code string) string {
	return a.t("Únete a mi mesa: ", "Join my table: ") + inv + "\n" + a.t("Código: ", "Code: ") + fmtCode(code)
}

// fmtCode escribe el código de seis letras como «ABC-DEF».
func fmtCode(c string) string {
	if len(c) == 6 {
		return c[:3] + "-" + c[3:]
	}
	return c
}

func (s *doneScreen) Keys(a *App) [][2]string {
	if a.cfg.Docker {
		return [][2]string{{"o", a.t("abrir la carpeta", "open the folder")}, {"enter", a.t("salir", "quit")}, {"?", a.t("ayuda", "help")}, {"q", a.t("salir", "quit")}}
	}
	return [][2]string{{"enter", a.t("abrir como DM", "open as DM")}, {"c", a.t("copiar enlace y código", "copy link and code")}, {"p", a.t("panel", "panel")}, {"?", a.t("ayuda", "help")}, {"q", a.t("salir", "quit")}}
}

func (s *doneScreen) Help(a *App) string {
	return a.t("Comparte el enlace de invitación y el código con tus jugadores: pueden escribirlo o escanear el QR con el móvil. Enter o «o» te abre la mesa como DM (director de juego) en el navegador. Para volver a este panel, ejecuta «lantern» otra vez.", "Share the invite link and code with your players: they can type it or scan the QR with a phone. Enter or \"o\" opens the table as DM (game master) in the browser. To return to this dashboard, run \"lantern\" again.")
}

func (s *doneScreen) View(a *App, w, h int) string {
	th := a.th
	if a.cfg.Docker {
		dir, rest, _ := strings.Cut(s.text, "\n\n")
		return th.Done.Render("✓ ") + th.Title.Render(a.t("Archivos listos para tu NAS", "Files ready for your NAS")) + "\n\n" +
			wrap(a.t("He creado «docker-compose.yml» y «lantern.env» en:", "I created \"docker-compose.yml\" and \"lantern.env\" in:"), w) + "\n" + th.Link.Render(dir) + "\n\n" +
			wrap(a.t("Súbelos a tu NAS y sigue los pasos de tu modelo:", "Upload them to your NAS and follow the steps for your model:"), w) + "\n" + wrap(rest, w)
	}
	mark := map[bool]string{true: " ✓", false: ""}[s.copied]
	acts := []string{th.button(a.t("Abrir la mesa como DM", "Open the table as DM"), a.t("pulsa enter", "press enter")),
		th.Key.Render("[c]") + " " + a.t("Copiar enlace y código", "Copy link and code") + th.Done.Render(mark),
		th.Key.Render("[p]") + " " + a.t("Ir al panel de control", "Go to the control panel")}
	foot := th.Muted.Render(a.t("Para volver aquí más tarde ejecuta «lantern»: estado, registros, actualizar y desinstalar.", "To come back later run \"lantern\": status, logs, update and uninstall."))
	head := th.Done.Render("✓ ") + th.Title.Render(a.t("¡Tu mesa está lista!", "Your table is ready!")) + "\n" +
		th.Muted.Render(a.t("Pasa el enlace y el código a tus jugadores. Tú entras como DM.", "Send the link and code to your players. You join as DM."))
	return inviteView(a, head, a.inviteURL(), a.result.Code, acts, foot, w, h, s.qr)
}

// inviteView: enlace, código y acciones a la izquierda y el QR a la derecha. Si no cabe, se ofrece con la tecla «v».
func inviteView(a *App, head, inv, code string, acts []string, foot string, w, h int, onlyQR bool) string {
	th := a.th
	if inv == "" {
		return head + "\n\n" + wrap(a.t("Aún no hay enlace: el servidor no está publicado.", "No link yet: the server is not published."), w)
	}
	q := renderQR(inv, th.mono, th.dark)
	qw, qh := lipgloss.Width(q), strings.Count(q, "\n")+1
	if onlyQR {
		if qh > h || qw > w {
			return th.Bad.Render(wrap(a.t("Este QR no cabe en la ventana. Agranda el terminal (o reduce la letra) y vuelve a pulsar «v».", "This QR does not fit the window. Enlarge the terminal (or reduce the font) and press \"v\" again."), w)) + "\n\n" + th.Key.Render("v") + " " + th.Muted.Render(a.t("volver", "back"))
		}
		if qh == h { // sin sitio para la leyenda
			return q
		}
		return q + "\n" + th.Muted.Render(a.t("Escanéalo con la cámara del móvil · ", "Scan it with the phone camera · ")) + th.Key.Render("v") + " " + th.Muted.Render(a.t("volver", "back"))
	}
	side := w >= qw+3+36 && qh+1 <= h
	lw := w
	if side {
		lw = w - qw - 3
	}
	if !side {
		acts = append([]string{acts[0]}, append([]string{th.Key.Render("[v]") + " " + a.t("Ver el QR para escanear con el móvil", "Show the QR to scan with a phone")}, acts[1:]...)...)
	}
	shown := inv // el código se ve aparte: en el recuadro va solo la dirección
	if u, err := url.Parse(inv); err == nil {
		u.RawQuery, u.Fragment = "", ""
		shown = strings.TrimSuffix(u.String(), "/")
	}
	big := blockText(fmtCode(code))
	bigW := lipgloss.Width(big[0])
	build := func(level int) string { // 0 completo; 1 sin la nota final; 2 código en una línea; 3 además sin líneas en blanco ni aviso del túnel
		left := []string{head, "", th.label(a.t("Enlace para tus jugadores", "Link for your players")), th.box(styled(th.Link, wrap(shown, lw-4)), lw-2), ""}
		if level < 2 && lw >= bigW+6 {
			left = append(left, th.label(a.t("Código de la mesa", "Table code")), th.box(styled(th.Sub, strings.Join(big, "\n")), lw-2), "")
		} else {
			left = append(left, th.label(a.t("Código de la mesa", "Table code"))+"  "+th.Title.Render(fmtCode(code)), "")
		}
		if a.cfg.Tunnel == "quick" && level < 2 {
			left = append(left, styled(th.Muted, wrap(a.t("Este enlace es temporal: cambia si el túnel se reinicia. El panel te dará el nuevo.", "This link is temporary: it changes if the tunnel restarts. The dashboard will give you the new one."), lw)), "")
		}
		for _, x := range acts {
			left = append(left, wrap(x, lw))
		}
		if foot != "" && level < 1 {
			left = append(left, "", styled(th.Muted, wrap(ansi.Strip(foot), lw)))
		}
		if level == 3 {
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
	for lv := 1; lv <= 3 && strings.Count(txt, "\n")+1 > h; lv++ {
		txt = build(lv)
	}
	if !side {
		return txt
	}
	return lipgloss.JoinHorizontal(lipgloss.Top, lipgloss.NewStyle().Width(lw).Render(txt), "   ", q+"\n"+th.Muted.Render(a.t("escanéalo con el móvil", "scan it with your phone")))
}
