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
		return &textScreen{base: base{1}, render: func(a *App, w int) string { return a.th.Bad.Render(wrap(err.Error(), w)) }}
	}
	a.cfg.SSHKeyPath, a.cfg.SSHUser = key, "ubuntu"
	in := textinput.New()
	in.Prompt, in.Placeholder = "▸ ", "132.145.20.7"
	in.SetValue(a.cfg.SSHHost)
	return &oracleScreen{base: base{1}, steps: cloud.OracleSteps(a.pick2("es", "en")), pub: pub, in: in, sp: spinner.New(spinner.WithSpinner(spinner.Dot))}
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
	th := a.th
	st := s.steps[s.i]
	wide := w >= 74 // con sitio, la lista de pasos va a la izquierda y el detalle a la derecha
	lw, rw := 0, w
	if wide {
		lw = 32
		rw = w - lw - 4
	}
	var d []string
	if !wide {
		d = append(d, th.Cur.Render(strings.ToUpper(st.Title)))
	} else {
		d = append(d, th.Cur.Render(strings.ToUpper(fmt.Sprintf(a.t("Paso %d · %s", "Step %d · %s"), s.i+1, st.Title))))
	}
	d = append(d, styled(th.Sub, wrap(st.Body, rw)))
	if s.i == cloud.OracleKeyStep || s.i == cloud.OracleKeyStep+1 {
		d = append(d, "", s.keyBox(a, rw))
		acts := th.Key.Render("[c]") + " " + a.t("copiar la clave", "copy the key")
		if st.URL != "" {
			acts += "     " + th.Key.Render("[o]") + " " + a.t("abrir la web ", "open the web page ") + th.Link.Render(host(st.URL))
		}
		d = append(d, acts)
	} else if st.URL != "" {
		d = append(d, "", th.Key.Render("[o]")+" "+a.t("abrir la web ", "open the web page ")+th.Link.Render(host(st.URL)))
	}
	if s.last() {
		s.in.SetWidth(max(10, rw-6))
		d = append(d, "", th.label(a.t("IP de la máquina", "Machine IP")), th.box(s.in.View(), rw))
		switch s.state {
		case 1:
			d = append(d, s.sp.View()+" "+a.t("Comprobando que llego a la máquina…", "Checking that I can reach the machine…"))
		case 2:
			d = append(d, th.Bad.Render(wrap("! "+s.msg, rw)))
		}
	}
	var btn []string // el botón queda fijo al pie: solo se desplaza el texto
	if s.state != 1 {
		next := a.t("Siguiente", "Next")
		if s.i == cloud.OracleKeyStep+1 { // crear la máquina
			next = a.t("Ya la he creado", "I have created it")
		}
		if s.last() {
			next = a.t("Comprobar y continuar", "Check and continue")
		}
		btn = []string{"", th.button(next, a.t("pulsa enter", "press enter"))}
	}
	lines := strings.Split(strings.Join(d, "\n"), "\n")
	if room := max(3, h-len(btn)-1); len(lines) > room { // deja sitio a la marca «↑↓ …»
		s.scroll = min(s.scroll, len(lines)-room)
		lines = append(lines[s.scroll:s.scroll+room], th.Muted.Render("  ↑↓ …"))
	}
	lines = append(lines, btn...)
	if !wide {
		return th.Muted.Render(fmt.Sprintf(a.t("Oracle · paso %d de %d", "Oracle · step %d of %d"), s.i+1, len(s.steps))) + "\n\n" + strings.Join(lines, "\n")
	}
	left := []string{th.label(a.t("Guía de Oracle", "Oracle guide")), ""}
	for i, x := range s.steps {
		t := clip(fmt.Sprintf("%d  %s", i+1, x.Title), lw-4)
		switch {
		case i < s.i:
			left = append(left, th.Done.Render("✓ ")+th.Soft.Render(t))
		case i == s.i:
			left = append(left, th.Sel.Render("▸ "+t+strings.Repeat(" ", max(0, lw-2-lipgloss.Width(t)))))
		default:
			left = append(left, th.Todo.Render("○ "+t))
		}
	}
	left = append(left, "", th.bar(float64(s.i)/float64(len(s.steps)), lw-8),
		th.Muted.Render(fmt.Sprintf(a.t("%d de %d hechos", "%d of %d done"), s.i, len(s.steps))), "",
		th.Sub.Render(a.t("¿Algo no cuadra?", "Something off?")), th.Muted.Render(a.t("Pulsa ? y te lo explicamos", "Press ? for a longer")), th.Muted.Render(a.t("con más calma.", "explanation.")))
	var out []string
	for y := 0; y < max(len(left), len(lines)); y++ {
		l, r := "", ""
		if y < len(left) {
			l = left[y]
		}
		if y < len(lines) {
			r = lines[y]
		}
		out = append(out, l+strings.Repeat(" ", max(0, lw-lipgloss.Width(l)))+" "+th.Rule.Render("│")+"  "+r)
	}
	return strings.Join(out, "\n")
}

// keyBox muestra la clave pública entera (para seleccionarla si el portapapeles no funciona) y el estado de la copia.
func (s *oracleScreen) keyBox(a *App, w int) string {
	k := s.pub
	if lipgloss.Width(k) > w-4 { // no cabe en una línea: se parte
		k = ansi.Hardwrap(k, w-4, true)
	}
	box := a.th.Box.Render(a.th.Sub.Render(k))
	switch s.copied {
	case 1:
		return a.th.label(a.t("Tu clave de acceso", "Your access key")) + "  " + a.th.Good.Render(a.t("✓ ya está en el portapapeles", "✓ copied to the clipboard")) + "\n" + box
	case 2:
		return a.th.label(a.t("Tu clave de acceso", "Your access key")) + "\n" + box + "\n" + styled(a.th.Muted, wrap(a.t("Se la he pedido a tu terminal. Si al pegar no sale nada, selecciona la clave de arriba con el ratón y cópiala.", "I asked your terminal to copy it. If pasting gives nothing, select the key above with the mouse and copy it."), w))
	}
	return a.th.label(a.t("Tu clave de acceso", "Your access key")) + "\n" + box
}

func (s *oracleScreen) Keys(a *App) [][2]string {
	back := [2]string{"esc", a.t("atrás", "back")}
	if s.last() {
		return [][2]string{{"enter", a.t("comprobar y continuar", "check and continue")}, back, {"ctrl+c", a.t("salir", "quit")}}
	}
	ks := [][2]string{{"c", a.t("copiar la clave", "copy the key")}}
	if s.steps[s.i].URL != "" {
		ks = append(ks, [2]string{"o", a.t("abrir la web", "open the web page")})
	}
	return append(ks, [2]string{"enter", a.t("siguiente", "next")}, back, [2]string{"?", a.t("ayuda", "help")}, [2]string{"q", a.t("salir", "quit")})
}

// host: la web sin esquema ni ruta, para mostrarla («cloud.oracle.com»).
func host(u string) string {
	h, _, _ := strings.Cut(strings.TrimPrefix(u, "https://"), "/")
	return h
}
