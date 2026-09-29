package ui

import (
	"context"
	"fmt"
	"net"
	"strings"
	"time"

	"charm.land/bubbles/v2/spinner"
	"charm.land/bubbles/v2/textinput"
	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

	"lantern/installer/cloud"
	"lantern/installer/platform"
	"lantern/installer/remote"
)

// copyText copia s al portapapeles: herramienta del sistema si existe y siempre OSC 52. Devuelve si la herramienta funcionó.
func copyText(s string) (tea.Cmd, bool) { return tea.SetClipboard(s), platform.CopyText(s) }

// ---------- Oracle: guía paso a paso (una tarea por pantalla) ----------

type oracleScreen struct {
	base
	steps  []cloud.GuideStep
	pub    string
	i      int
	copied int // 0 no copiada, 1 copiada con el portapapeles del sistema, 2 solo OSC 52
	in     textinput.Model
	state  int // 0 escribiendo, 1 comprobando, 2 falló
	msg    string
	sp     spinner.Model
	scroll int
}

type oracleCheckMsg struct {
	ip, ssh string
	web     bool
}

func oracleGuide(a *App) screen {
	key, pub, err := remote.EnsureKey(a.cfg.DataDir)
	if err != nil {
		return &textScreen{base: base{2}, render: func(a *App, w int) string { return a.th.Bad.Render(wrap(err.Error(), w)) }}
	}
	a.cfg.SSHKeyPath, a.cfg.SSHUser = key, "ubuntu"
	in := textinput.New()
	in.Prompt, in.Placeholder = "▸ ", "132.145.20.7"
	in.SetValue(a.cfg.SSHHost)
	return &oracleScreen{base: base{2}, steps: cloud.OracleSteps(a.pick2("es", "en")), pub: pub, in: in, sp: spinner.New(spinner.WithSpinner(spinner.Dot))}
}

func (s *oracleScreen) NoBack()      {}
func (s *oracleScreen) last() bool   { return s.i == len(s.steps)-1 }
func (s *oracleScreen) Typing() bool { return s.last() && s.state != 1 }
func (s *oracleScreen) Help(a *App) string {
	return a.t("La clave que se copia en este asistente es solo la parte pública (como una cerradura): sirve para que yo pueda entrar en tu servidor de Oracle. La parte privada se queda en tu equipo y no sale de él.",
		"The key copied here is only the public half (like a lock): it lets me log into your Oracle server. The private half stays on your computer and never leaves it.")
}

func (s *oracleScreen) Init(a *App) tea.Cmd {
	s.state, s.msg = 0, ""
	if s.last() {
		return s.in.Focus()
	}
	return nil
}

func (s *oracleScreen) goStep(a *App, d int) tea.Cmd {
	s.i, s.scroll, s.state, s.msg = s.i+d, 0, 0, ""
	if s.last() {
		return s.in.Focus()
	}
	s.in.Blur()
	return nil
}

func (s *oracleScreen) check(a *App, ip string) tea.Cmd {
	ctx := a.ctx
	return func() tea.Msg {
		c, cancel := context.WithTimeout(ctx, 15*time.Second)
		defer cancel()
		ssh, web := cloud.CheckOracle(c, ip)
		return oracleCheckMsg{ip, ssh, web}
	}
}

func (s *oracleScreen) ipError(a *App, v string) string {
	ip := net.ParseIP(v)
	switch {
	case ip == nil:
		return a.t("Eso no parece una IP. Tiene este aspecto: 132.145.20.7 (cuatro números separados por puntos).", "That does not look like an IP. It looks like this: 132.145.20.7 (four numbers separated by dots).")
	case ip.IsPrivate() || ip.IsLoopback():
		return a.t("Esa IP es privada: solo vale dentro de la red de Oracle. Necesito la «Public IP address» de la instancia.", "That IP is private: it only works inside Oracle's network. I need the instance's \"Public IP address\".")
	}
	return ""
}

func (s *oracleScreen) Update(a *App, msg tea.Msg) tea.Cmd {
	switch m := msg.(type) {
	case spinner.TickMsg:
		if s.state == 1 {
			var c tea.Cmd
			s.sp, c = s.sp.Update(m)
			return c
		}
		return nil
	case oracleCheckMsg:
		if s.state != 1 || m.ip != strings.TrimSpace(s.in.Value()) {
			return nil
		}
		switch {
		case m.ssh == "filtered":
			s.msg = a.t("No consigo hablar con esa IP. Revisa que:\n• sea la «Public IP address» de la instancia (no la «Private IP»);\n• la instancia ponga «Running» en verde;\n• no hayas quitado la regla del puerto 22 de la «Default Security List» (viene puesta por defecto).",
				"I cannot reach that IP. Check that:\n• it is the instance's \"Public IP address\" (not the \"Private IP\");\n• the instance says \"Running\" in green;\n• you did not remove the port 22 rule of the \"Default Security List\" (it is there by default).")
		case m.ssh != "open":
			s.msg = a.t("La máquina responde pero aún no acepta conexiones. Suele tardar uno o dos minutos tras crearla. Espera un poco y pulsa Enter otra vez.",
				"The machine answers but does not accept connections yet. It usually takes a minute or two after creating it. Wait a bit and press Enter again.")
		case m.web:
			s.msg = a.t("La máquina responde, pero Oracle bloquea las puertas de la web (puertos 80 y 443), y sin ellas nadie podría entrar. Vuelve con Esc al paso 4, añade la regla en «Ingress Rules» y pulsa Enter otra vez.",
				"The machine answers, but Oracle blocks the web doors (ports 80 and 443), so nobody could get in. Press Esc to go back to step 4, add the rule in \"Ingress Rules\" and press Enter again.")
		default:
			a.cfg.SSHHost = m.ip
			return a.goTo(remoteForm(a))
		}
		s.state = 2
		return nil
	case tea.KeyPressMsg:
		k := m.String()
		switch {
		case k == "esc":
			switch {
			case s.state == 1:
				s.state = 0
			case s.i > 0:
				return s.goStep(a, -1)
			default:
				return a.back()
			}
			return nil
		case s.state == 1:
			return nil
		case s.last():
			if k != "enter" {
				var c tea.Cmd
				s.in, c = s.in.Update(msg)
				s.state, s.msg = 0, ""
				return c
			}
			v := strings.TrimSpace(s.in.Value())
			if e := s.ipError(a, v); e != "" {
				s.state, s.msg = 2, e
				return nil
			}
			s.state, s.msg = 1, ""
			return tea.Batch(s.sp.Tick, s.check(a, v))
		}
		switch k {
		case "enter", "right":
			return s.goStep(a, 1)
		case "left":
			if s.i > 0 {
				return s.goStep(a, -1)
			}
		case "up", "k":
			s.scroll = max(0, s.scroll-1)
		case "down", "j":
			s.scroll++
		case "o":
			if u := s.steps[s.i].URL; u != "" {
				_ = platform.OpenURL(u)
			}
		case "c":
			cmd, ok := copyText(s.pub)
			s.copied = 2
			if ok {
				s.copied = 1
			}
			return cmd
		}
		return nil
	}
	if s.last() && s.state != 1 { // pegado y parpadeo del cursor
		var c tea.Cmd
		s.in, c = s.in.Update(msg)
		return c
	}
	return nil
}

func (s *oracleScreen) View(a *App, w, h int) string {
	st := s.steps[s.i]
	title := a.th.Title.Render(a.t("Oracle Cloud: tu servidor gratis", "Oracle Cloud: your free server")) + "  " +
		a.th.Muted.Render(fmt.Sprintf(a.t("paso %d de %d", "step %d of %d"), s.i+1, len(s.steps)))
	list := make([]string, len(s.steps))
	for i, x := range s.steps {
		t := clip(fmt.Sprintf("%d  %s", i+1, x.Title), w-6)
		switch {
		case i < s.i:
			list[i] = a.th.Done.Render("  ✓ " + t)
		case i == s.i:
			list[i] = a.th.Cur.Render("  ▸ " + t)
		default:
			list[i] = a.th.Todo.Render("  ○ " + t)
		}
	}
	var d []string
	d = append(d, a.th.Accent.Render(st.Title), styled(a.th.Sub, wrap(st.Body, w)))
	if s.i == cloud.OracleKeyStep || (s.i == cloud.OracleKeyStep+1) {
		d = append(d, "", s.keyBox(a, w))
	}
	if s.last() {
		s.in.SetWidth(max(10, w-6))
		d = append(d, "", a.th.Box.Width(w).Render(s.in.View()))
		switch s.state {
		case 1:
			d = append(d, s.sp.View()+" "+a.t("Comprobando que llego a la máquina…", "Checking that I can reach the machine…"))
		case 2:
			d = append(d, a.th.Bad.Render(wrap("✗ "+s.msg, w)))
		}
	}
	hint := s.hint(a)
	body := strings.Join(d, "\n")
	// Si no cabe con la lista completa, se compacta a una línea; si aún no cabe, se desplaza.
	head := title + "\n" + strings.Join(list, "\n") + "\n\n"
	if strings.Count(head+body, "\n")+3 > h {
		bar := make([]string, len(s.steps))
		for i := range bar {
			bar[i] = map[bool]string{true: "●", false: "○"}[i <= s.i]
		}
		head = title + "  " + a.th.Cur.Render(strings.Join(bar, " ")) + "\n\n"
	}
	lines := strings.Split(body, "\n")
	room := max(3, h-strings.Count(head, "\n")-4) // deja sitio a la marca «↑↓ …», la línea en blanco y la ayuda de teclas
	if len(lines) > room {
		s.scroll = min(s.scroll, len(lines)-room)
		lines = append(lines[s.scroll:s.scroll+room], a.th.Muted.Render("  ↑↓ …"))
	}
	return head + strings.Join(lines, "\n") + "\n\n" + hint
}

// keyBox muestra la clave pública entera (para seleccionarla si el portapapeles no funciona) y el estado de la copia.
func (s *oracleScreen) keyBox(a *App, w int) string {
	k := s.pub
	if lipgloss.Width(k) > w-4 { // no cabe en una línea: se parte
		k = ansi.Hardwrap(k, w-4, true)
	}
	box := a.th.Box.Render(a.th.Accent.Render(k))
	switch s.copied {
	case 1:
		return box + "\n" + a.th.Good.Render(a.t("✓ Copiada al portapapeles.", "✓ Copied to the clipboard."))
	case 2:
		return box + "\n" + styled(a.th.Muted, wrap(a.t("Se la he pedido a tu terminal. Si al pegar no sale nada, selecciona la clave de arriba con el ratón y cópiala.", "I asked your terminal to copy it. If pasting gives nothing, select the key above with the mouse and copy it."), w))
	}
	return box
}

func (s *oracleScreen) hint(a *App) string {
	var p []string
	key := func(k, txt string) { p = append(p, a.th.Key.Render(k)+" "+a.th.Muted.Render(txt)) }
	if s.last() {
		key("Enter", a.t("comprobar y continuar", "check and continue"))
	} else {
		if s.steps[s.i].URL != "" {
			key("o", a.t("abrir la web", "open the web page"))
		}
		key("c", a.t("copiar la clave", "copy the key"))
		key("Enter", a.t("siguiente", "next"))
	}
	if s.i > 0 {
		key("Esc", a.t("paso anterior", "previous step"))
	} else {
		key("Esc", a.t("volver", "back"))
	}
	return strings.Join(p, a.th.Muted.Render(" · "))
}
