package ui

import (
	"context"
	"fmt"
	"os"
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"

	"lantern/installer/ai"
	"lantern/installer/model"
	"lantern/installer/platform"
)

// Options son las entradas del asistente/panel.
type Options struct {
	Paths     platform.Paths
	Base      model.Config // valores de banderas (ServerBin, Releases, DataDir, NoService…)
	Deployers map[string]model.Deployer
	Panel     bool
	Lang      string // "es"|"en" detectado
}

type screen interface {
	Init(a *App) tea.Cmd
	Update(a *App, msg tea.Msg) tea.Cmd
	View(a *App, w, h int) string
	Typing() bool // hay un campo de texto con el foco: ? y las letras no son atajos
	Stage() int   // paso de la barra superior (-1 ninguno)
	Help(a *App) string
}

type base struct{ stage int }

func (base) Init(*App) tea.Cmd { return nil }
func (base) Typing() bool      { return false }
func (b base) Stage() int      { return b.stage }
func (base) Help(*App) string  { return "" }

// App es el modelo raíz de Bubble Tea.
type App struct {
	o        Options
	th       theme
	cfg      model.Config
	w, h     int
	cur      screen
	hist     []screen
	help     bool
	ctx      context.Context
	cancel   context.CancelFunc
	catalog  []ai.Provider
	ai       aiFlow
	result   model.Result
	ver      string // versión instalada, para la cabecera del panel
	quitting bool
}

// Cabecera fija: título, barra de pasos, línea y un hueco. Al pie, otra línea y los atajos.
const headerLines = 4

// stagePanel: en el panel todos los pasos de la barra figuran como hechos.
const stagePanel = 7

func New(o Options) *App {
	ctx, cancel := context.WithCancel(context.Background())
	cat, _ := ai.Load()
	a := &App{o: o, th: newTheme(true, os.Getenv("NO_COLOR") != ""), cfg: o.Base, ctx: ctx, cancel: cancel, catalog: cat, w: 100, h: 30}
	if a.cfg.Lang == "" {
		a.cfg.Lang = o.Lang
	}
	if a.cfg.DataDir == "" {
		a.cfg.DataDir = o.Paths.Data
	}
	return a
}

func (a *App) es() bool { return a.cfg.Lang != "en" }

// t elige el texto según el idioma.
func (a *App) t(es, en string) string {
	if a.es() {
		return es
	}
	return en
}

func (a *App) Init() tea.Cmd {
	if a.o.Panel {
		a.cur = newPanel()
	} else {
		a.cur = newWelcome(a)
	}
	// El fondo se consulta sin bloquear: hasta que el terminal responda (o si no lo hace) el tema es oscuro.
	return tea.Batch(a.cur.Init(a), tea.RequestBackgroundColor)
}

// goTo apila la pantalla actual y muestra s.
func (a *App) goTo(s screen) tea.Cmd {
	a.hist = append(a.hist, a.cur)
	a.cur, a.help = s, false
	return s.Init(a)
}

// replace cambia de pantalla sin poder volver a la actual.
func (a *App) replace(s screen) tea.Cmd {
	a.cur, a.help = s, false
	return s.Init(a)
}

func (a *App) back() tea.Cmd {
	if n := len(a.hist); n > 0 {
		a.cur, a.hist = a.hist[n-1], a.hist[:n-1]
		a.help = false
		return a.cur.Init(a)
	}
	return nil
}

// reset borra el historial (p. ej. al terminar de instalar no se puede volver atrás).
func (a *App) reset(s screen) tea.Cmd {
	a.hist = nil
	return a.replace(s)
}

// avail son las líneas que quedan para el cuerpo de la pantalla (cabecera y pie descontados).
func (a *App) avail() int { return max(5, a.h-headerLines-2) }

// Busy marca las pantallas que trabajan en segundo plano: ahí «q» no sale.
type busy interface{ Busy() }

func (a *App) width() int { return max(40, min(a.w-4, 96)) }

func (a *App) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch m := msg.(type) {
	case tea.WindowSizeMsg:
		a.w, a.h = m.Width, m.Height
	case tea.BackgroundColorMsg:
		a.th = newTheme(m.IsDark(), a.th.mono)
		return a, nil
	case tea.KeyPressMsg:
		switch k := m.String(); {
		case k == "ctrl+c":
			a.cancel()
			a.quitting = true
			return a, tea.Quit
		case k == "q" && !a.cur.Typing():
			if _, working := a.cur.(busy); !working {
				a.cancel()
				a.quitting = true
				return a, tea.Quit
			}
		case k == "f1" || (k == "?" && !a.cur.Typing()):
			a.help = !a.help
			return a, nil
		case k == "esc" && a.help:
			a.help = false
			return a, nil
		case k == "esc":
			if _, busy := a.cur.(interface{ NoBack() }); !busy {
				return a, a.back()
			}
		}
	case tea.MouseClickMsg:
		m.Y -= headerLines
		msg = m
	case tea.MouseWheelMsg:
		m.Y -= headerLines
		msg = m
	}
	return a, a.cur.Update(a, msg)
}

var stepNames = [][2]string{{"Bienvenida", "Welcome"}, {"Dónde", "Where"}, {"Enlace", "Address"}, {"IA", "AI"}, {"Tu mesa", "Your table"}, {"Instalar", "Install"}, {"Listo", "Done"}}

func (a *App) stepBar() string {
	cur := a.cur.Stage()
	var names []string
	total := 0
	for i, n := range stepNames {
		name := n[0]
		if !a.es() {
			name = n[1]
		}
		switch {
		case i < cur:
			names = append(names, a.th.Done.Render("✓")+a.th.Soft.Render(" "+name))
		case i == cur:
			names = append(names, a.th.Now.Render("● "+name))
		default:
			names = append(names, a.th.Todo.Render("○ "+name))
		}
		total += lipgloss.Width(name) + 2
	}
	sep := " " // el separador más ancho que quepa
	for _, s := range []string{"  ──  ", " ── ", " ─ "} {
		if total+(len(names)-1)*lipgloss.Width(s) <= a.w-2 {
			sep = s
			break
		}
	}
	return strings.Join(names, a.th.Rule.Render(sep))
}

// hints son los atajos de la última fila: los de la pantalla, o unos por defecto.
func (a *App) hints() [][2]string {
	switch k, ok := a.cur.(interface{ Keys(*App) [][2]string }); {
	case a.help:
		return [][2]string{{"?", a.t("cerrar la ayuda", "close help")}, {"esc", a.t("atrás", "back")}, {"q", a.t("salir", "quit")}}
	case ok:
		return k.Keys(a)
	case a.cur.Typing():
		return [][2]string{{"enter", a.t("continuar", "continue")}, {"esc", a.t("atrás", "back")}, {"ctrl+c", a.t("salir", "quit")}}
	}
	return [][2]string{{"↑↓", a.t("elegir", "move")}, {"enter", a.t("continuar", "continue")}, {"esc", a.t("atrás", "back")}, {"?", a.t("ayuda", "help")}, {"q", a.t("salir", "quit")}}
}

func (a *App) View() tea.View {
	w := a.width()
	sub, right := a.t("asistente de instalación", "setup assistant"), fmt.Sprintf(a.t("paso %d de 7", "step %d of 7"), a.cur.Stage()+1)
	if a.cur.Stage() >= stagePanel {
		sub, right = a.t("panel de control", "control panel"), a.ver
	} else if a.cur.Stage() < 0 {
		right = ""
	}
	head := a.th.Soft.Render("◆") + a.th.Title.Render(" LANTERN") + a.th.Muted.Render("  "+sub)
	head += strings.Repeat(" ", max(1, w-lipgloss.Width(head)-lipgloss.Width(right))) + a.th.Muted.Render(right)
	bar := ""
	if a.cur.Stage() >= 0 {
		bar = a.stepBar()
	}
	rule := a.th.Rule.Render(strings.Repeat("─", w))
	avail := a.avail()
	var body string
	if a.help {
		body = a.th.Title.Render(a.t("Ayuda", "Help")) + "\n\n" + wrap(a.cur.Help(a)+"\n\n"+a.t(
			"Teclas: ↑↓ elegir · Enter continuar · Esc volver · ? cerrar la ayuda · q salir.\nTambién puedes usar el ratón: clic para elegir y rueda para desplazar.\nLas claves que pegas no se muestran en pantalla ni se guardan en registros.",
			"Keys: ↑↓ move · Enter continue · Esc back · ? close help · q quit.\nThe mouse works too: click to choose, wheel to scroll.\nKeys you paste are never shown on screen or written to logs."), w)
	} else {
		body = a.cur.View(a, w, avail)
	}
	lines := strings.Split(body, "\n")
	if len(lines) > avail {
		lines = lines[:avail]
	}
	for len(lines) < avail {
		lines = append(lines, "")
	}
	for i, l := range lines { // nada se sale del ancho: una línea larga partiría la pantalla
		lines[i] = ansi.Truncate(l, w, "")
	}
	out := lipgloss.NewStyle().PaddingLeft(2).Render(head + "\n" + bar + "\n" + rule + "\n\n" + strings.Join(lines, "\n") + "\n" + rule + "\n" + a.th.keyHints(a.hints(), w))
	v := tea.NewView(out)
	v.AltScreen = true
	v.MouseMode = tea.MouseModeCellMotion
	v.WindowTitle = "Lantern"
	return v
}

// Run arranca el programa interactivo.
func Run(o Options) error {
	a := New(o)
	_, err := tea.NewProgram(a).Run()
	return err
}

// async ejecuta f fuera del bucle y devuelve su resultado como mensaje.
func async(f func() tea.Msg) tea.Cmd { return f }
