package ui

import (
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"
)

// ---- formScreen: un formulario de Huh (una pregunta por pantalla) ----

type formScreen struct {
	base
	intro string
	form  *huh.Form
	done  func(a *App) tea.Cmd
	fired bool
	help  string
}

func newForm(a *App, stage int, intro string, f *huh.Form, done func(*App) tea.Cmd) *formScreen {
	f = f.WithTheme(a.th.huh).WithShowHelp(false).WithWidth(a.width()).WithShowErrors(true)
	return &formScreen{base: base{stage}, intro: intro, form: f, done: done}
}

func (s *formScreen) Init(a *App) tea.Cmd { return s.form.Init() }
func (s *formScreen) Update(a *App, msg tea.Msg) tea.Cmd {
	if _, ok := msg.(tea.MouseMsg); ok {
		return nil
	}
	_, cmd := s.form.Update(msg)
	if s.form.State == huh.StateCompleted && !s.fired {
		s.fired = true
		return tea.Batch(cmd, s.done(a))
	}
	return cmd
}
func (s *formScreen) Typing() bool {
	switch s.form.GetFocusedField().(type) {
	case *huh.Input, *huh.Select[string]: // el segundo puede estar filtrando: las letras son texto
		return true
	}
	return false
}
func (s *formScreen) Help(*App) string { return s.help }
func (s *formScreen) View(a *App, w, h int) string {
	out := s.form.View()
	if s.intro != "" {
		out = styled(a.th.Muted, wrap(s.intro, w)) + "\n\n" + out
	}
	return out
}

// ---- textScreen: texto con desplazamiento y atajos ----

type textScreen struct {
	base
	render func(a *App, w int) string
	scroll int
	enter  func(a *App) tea.Cmd // nil: Enter no hace nada
	keys   map[string]func(a *App) tea.Cmd
	kh     [][2]string // atajos del pie (nil: los de desplazar)
	help   string
	nb     bool
	lines  int
}

func (s *textScreen) Update(a *App, msg tea.Msg) tea.Cmd {
	switch m := msg.(type) {
	case tea.KeyPressMsg:
		switch k := m.String(); k {
		case "up", "k":
			s.scroll = max(0, s.scroll-1)
		case "down", "j":
			s.scroll++
		case "pgup":
			s.scroll = max(0, s.scroll-10)
		case "pgdown", "space":
			s.scroll += 10
		case "enter":
			if s.enter != nil {
				return s.enter(a)
			}
		default:
			if f, ok := s.keys[k]; ok {
				return f(a)
			}
		}
	case tea.MouseWheelMsg:
		if m.Button == tea.MouseWheelUp {
			s.scroll = max(0, s.scroll-2)
		} else if m.Button == tea.MouseWheelDown {
			s.scroll += 2
		}
	}
	return nil
}

func (s *textScreen) Help(*App) string { return s.help }
func (s *textScreen) View(a *App, w, h int) string {
	lines := strings.Split(s.render(a, w), "\n")
	room := max(3, h)
	if len(lines) > room {
		s.scroll = min(s.scroll, len(lines)-room)
		lines = append(lines[s.scroll:min(len(lines), s.scroll+room)], a.th.Muted.Render("  ↑↓ …"))
	} else {
		s.scroll = 0
	}
	return strings.Join(lines, "\n")
}

func (s *textScreen) Keys(a *App) [][2]string {
	if s.kh == nil {
		return [][2]string{{"↑↓", a.t("desplazar", "scroll")}, {"esc", a.t("atrás", "back")}, {"?", a.t("ayuda", "help")}, {"q", a.t("salir", "quit")}}
	}
	return s.kh
}

// ---- menuScreen: introducción + lista de opciones ----

type menuScreen struct {
	base
	intro func(a *App, w int) string
	ch    *choice
	pick  func(a *App, i int) tea.Cmd
	help  string
	extra func(a *App, w int) string // detalle bajo la lista según la selección
	btn   func(i int) string         // texto del botón principal para la opción elegida (nil: sin botón)
}

func (s *menuScreen) Update(a *App, msg tea.Msg) tea.Cmd {
	if s.ch.update(msg) {
		return s.pick(a, s.ch.sel)
	}
	return nil
}
func (s *menuScreen) Help(*App) string { return s.help }
func (s *menuScreen) View(a *App, w, h int) string {
	s.ch.radio = true
	intro := ""
	if s.intro != nil {
		intro = s.intro(a, w)
	}
	extra := ""
	if s.extra != nil {
		extra = s.extra(a, w)
	}
	btn, nb := "", 0
	if s.btn != nil {
		btn, nb = "\n\n"+a.th.button(s.btn(s.ch.sel), a.t("pulsa enter", "press enter")), 2
	}
	s.ch.Y0 = 0
	if intro != "" {
		s.ch.Y0 = strings.Count(intro, "\n") + 2
		intro += "\n\n"
	}
	room := h - s.ch.Y0 - strings.Count(extra, "\n") - nb - 1
	return intro + s.ch.view(a.th, w, room, false) + extra + btn
}

func mask(k string) string {
	if k == "" {
		return "—"
	}
	return "••••••••"
}
