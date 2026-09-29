package ui

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"charm.land/bubbles/v2/spinner"
	tea "charm.land/bubbletea/v2"
	"charm.land/huh/v2"
	"charm.land/lipgloss/v2"

	"lantern/installer/ai"
	"lantern/installer/model"
	"lantern/installer/platform"
)

// aiFlow guarda el proveedor en curso. slot 0 = principal, 1 = reserva.
type aiFlow struct {
	slot   int
	prov   ai.Provider
	params map[string]string
	key    string
	models []string
	model  string
	sid    string // id de instalación para x-opencode-session
	ep     ai.Endpoint
	onDone func(a *App) tea.Cmd // qué hacer al terminar todo el flujo de IA
	laya   bool                 // el catálogo ofrece la casilla de Laya (solo en el asistente)
	opened map[string]bool      // proveedores cuya página de la clave ya se abrió
}

// openURL abre una página en el navegador (variable para poder contarlo en las pruebas).
var openURL = platform.OpenURL

// openKeyPage abre la página de la clave; sin force, solo la primera vez que se elige ese proveedor.
func (f *aiFlow) openKeyPage(force bool) {
	if f.prov.KeyURL == "" || (!force && f.opened[f.prov.ID]) {
		return
	}
	if f.opened == nil {
		f.opened = map[string]bool{}
	}
	f.opened[f.prov.ID] = true
	_ = openURL(f.prov.KeyURL)
}

// headers copia las del proveedor y hace único por instalación el x-opencode-session.
func (f *aiFlow) headers() map[string]string {
	h := map[string]string{}
	for k, v := range f.prov.Headers {
		if k == "x-opencode-session" {
			v = "lantern-" + f.sid
		}
		h[k] = v
	}
	return h
}

func (f *aiFlow) endpoint() ai.Endpoint {
	return ai.Endpoint{Format: f.prov.Format, URL: f.prov.Resolve(f.params), Key: f.key, Headers: f.headers()}
}

// toAI arranca el flujo de IA del asistente (la casilla de Laya va en el mismo catálogo).
func (a *App) toAI() tea.Cmd {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	a.ai = aiFlow{sid: hex.EncodeToString(b), onDone: func(a *App) tea.Cmd { return a.toTable() }, laya: !a.cfg.Docker}
	a.cfg.LLM, a.cfg.LLM2 = nil, nil
	a.cfg.Laya = a.ai.laya && platform.FreeDisk(a.cfg.DataDir) >= 5<<30 // por defecto, si sobra disco
	return a.goTo(newProviderScreen(a))
}

// ---------- catálogo por pestañas ----------

var groupNames = map[string][2]string{
	"free": {"Gratis", "Free"}, "subscription": {"Suscripción", "Subscription"},
	"paid": {"De pago", "Paid"}, "local": {"Local", "Local"}, "none": {"Ninguna", "None"},
}

// providerScreen: una pestaña por grupo del catálogo y una última, «Ninguna», para seguir sin IA.
type providerScreen struct {
	base
	tab   int
	ch    *choice
	items [][]ai.Provider
	tabX  []int
}

func newProviderScreen(a *App) *providerScreen {
	s := &providerScreen{base: base{3}}
	for _, g := range ai.Groups {
		var ps []ai.Provider
		for _, p := range a.catalog {
			if p.Group == g {
				ps = append(ps, p)
			}
		}
		s.items = append(s.items, ps)
	}
	s.items = append(s.items, nil)
	s.rebuild(a)
	return s
}

func (s *providerScreen) none() bool { return s.tab == len(s.items)-1 }

func (s *providerScreen) rebuild(a *App) {
	var its []item
	for _, p := range s.items[s.tab] {
		title := p.Name
		if !p.Enabled {
			title += a.t("  (aún no disponible)", "  (not available yet)")
		}
		its = append(its, item{title: title, disabled: !p.Enabled})
	}
	s.ch = newChoice(its, 0)
	s.ch.radio = true
	if len(its) > 0 && its[0].disabled {
		s.ch.update(tea.KeyPressMsg{Code: tea.KeyDown})
	}
}

func (a *App) pick2(es, en string) string {
	if a.es() {
		return es
	}
	return en
}

func (s *providerScreen) Help(a *App) string {
	return a.t("Tab o ← → cambian de pestaña. «Gratis» no cuesta dinero pero tiene límites diarios. Claude Pro/Max y ChatGPT Plus/Pro no se pueden usar desde aplicaciones de terceros; si los tienes, usa la API de Anthropic u OpenAI (de pago por uso). «Ninguna» deja Lantern sin IA: puedes añadirla luego desde el panel.",
		"Tab or ← → switch tabs. “Free” costs nothing but has daily limits. Claude Pro/Max and ChatGPT Plus/Pro cannot be used from third-party apps; if you have them, use the Anthropic or OpenAI API (pay per use). “None” leaves Lantern without AI: add it later from the panel.")
}

func (s *providerScreen) Keys(a *App) [][2]string {
	ks := [][2]string{{"tab", a.t("pestaña", "tab")}, {"↑↓", a.t("elegir", "move")}}
	if a.ai.laya && a.ai.slot == 0 {
		ks = append(ks, [2]string{"espacio", a.t("Laya sí/no", "Laya on/off")})
	}
	return append(ks, [2]string{"enter", a.t("continuar", "continue")}, [2]string{"esc", a.t("atrás", "back")}, [2]string{"q", a.t("salir", "quit")})
}

func (s *providerScreen) Update(a *App, msg tea.Msg) tea.Cmd {
	switch m := msg.(type) {
	case tea.KeyPressMsg:
		switch m.String() {
		case "left", "h", "[", "shift+tab":
			s.tab = (s.tab + len(s.items) - 1) % len(s.items)
			s.rebuild(a)
			return nil
		case "right", "l", "]", "tab":
			s.tab = (s.tab + 1) % len(s.items)
			s.rebuild(a)
			return nil
		case "space":
			if a.ai.laya && a.ai.slot == 0 {
				a.cfg.Laya = !a.cfg.Laya
			}
			return nil
		case "enter":
			if s.none() {
				return a.ai.onDone(a)
			}
		}
	case tea.MouseClickMsg:
		if m.Y == 3 && m.Button == tea.MouseLeft {
			for i := len(s.tabX) - 1; i >= 0; i-- {
				if m.X-2 >= s.tabX[i] {
					s.tab = i
					s.rebuild(a)
					return nil
				}
			}
		}
	}
	if s.ch.update(msg) {
		p := s.items[s.tab][s.ch.sel]
		a.ai.prov, a.ai.params, a.ai.key = p, map[string]string{}, ""
		return a.goTo(newKeyScreen(a))
	}
	return nil
}

func (s *providerScreen) View(a *App, w, h int) string {
	th := a.th
	var tabs, under []string
	s.tabX = s.tabX[:0]
	x := 0
	names := append(append([]string{}, ai.Groups...), "none")
	for i, g := range names {
		n := " " + a.pick2(groupNames[g][0], groupNames[g][1]) + " "
		s.tabX = append(s.tabX, x)
		x += lipgloss.Width(n) + 3
		if i == s.tab {
			tabs = append(tabs, th.Cur.Render(n))
			under = append(under, th.Gold.Render(strings.Repeat("━", lipgloss.Width(n))))
		} else {
			tabs = append(tabs, th.Soft.Render(n))
			under = append(under, th.Rule.Render(strings.Repeat("─", lipgloss.Width(n))))
		}
	}
	head := th.Title.Render(a.t("¿Qué IA quieres que te ayude a dirigir?", "Which AI should help you run the game?")) + "\n" +
		styled(th.Muted, wrap(a.t("Narra escenas, da voz a los PNJ y aclara reglas. Podrás cambiarla cuando quieras.", "It narrates scenes, voices NPCs and clarifies rules. You can change it any time."), w)) + "\n\n" +
		strings.Join(tabs, "   ") + "\n" + strings.Join(under, th.Rule.Render("───")) + th.Rule.Render(strings.Repeat("─", max(0, w-x+3))) + "\n\n"

	// piezas opcionales, de la menos a la más importante: se descartan si no dejan sitio a la lista
	var box, warn, laya, btn string
	label := a.t("Continuar sin IA", "Continue without AI")
	if s.none() {
		box = th.box(th.Sub.Render(wrap(a.t("Lantern funciona sin IA: el DM lo lleva todo a mano. Puedes añadirla más tarde desde el panel.", "Lantern works without AI: the DM runs everything by hand. You can add it later from the panel."), w-4)), w-2)
	} else if s.ch.sel >= 0 && s.ch.sel < len(s.items[s.tab]) {
		p := s.items[s.tab][s.ch.sel]
		label = a.t("Continuar con ", "Continue with ") + p.Name
		txt := a.pick2(p.CostES, p.CostEN)
		if tm := a.pick2(p.TermsES, p.TermsEN); tm != "" {
			txt += "\n" + tm
		}
		if p.Verify {
			txt += "\n" + a.t("No he podido confirmar la dirección de este servicio; si falla, revisa su web.", "I could not confirm this service's address; if it fails, check its website.")
		}
		box = titledBox(th, p.Name, th.Sub.Render(wrap(txt, w-6)), w)
	}
	btn = th.button(label, a.t("pulsa enter", "press enter"))
	if a.ai.laya && a.ai.slot == 0 {
		chk := th.Muted.Render("[ ]")
		if a.cfg.Laya {
			chk = th.Cur.Render("[✓]")
		}
		laya = chk + " " + th.Title.Render(a.t("Laya, IA local para turnos de monstruo", "Laya, local AI for monster turns")) + th.Muted.Render(a.t("   gratis · en tu PC · ≈1,2 GB", "   free · on your PC · ≈1.2 GB")) +
			"\n" + th.Muted.Render(a.t("    Mueve a los monstruos en combate sin gastar tu cupo de IA.", "    Moves monsters in combat without spending your AI quota."))
	}
	warn = th.Bad.Render("! ") + th.Bad.UnsetBold().Render(wrap(a.t("Claude Pro y ChatGPT Plus no se pueden usar desde otras apps: solo sirven en su web.", "Claude Pro and ChatGPT Plus cannot be used from other apps: they only work on their website."), w-2))
	n := max(1, min(len(s.ch.items), 4))
	rest := func() int { // líneas que quedan para la lista
		used := strings.Count(head, "\n")
		for _, p := range []string{box, warn, laya, btn} {
			if p != "" {
				used += strings.Count(p, "\n") + 2
			}
		}
		return h - used - 1
	}
	for _, drop := range []*string{&warn, &box, &laya} {
		if rest() >= n {
			break
		}
		*drop = ""
	}
	s.ch.Y0 = strings.Count(head, "\n")
	list := ""
	if !s.none() {
		list = s.ch.view(th, w, max(3, rest()), false) + "\n\n"
	}
	out := head + list
	for _, p := range []string{box, warn, laya, btn} {
		if p != "" {
			out += p + "\n\n"
		}
	}
	return strings.TrimRight(out, "\n")
}

// titledBox: caja redondeada con el título metido en el borde superior.
func titledBox(th theme, title, body string, w int) string {
	top := th.Rule.Render("╭─ ") + th.Title.Render(title) + th.Rule.Render(" "+strings.Repeat("─", max(0, w-6-lipgloss.Width(title)))+"╮")
	var out = []string{top}
	for _, l := range strings.Split(body, "\n") {
		out = append(out, th.Rule.Render("│ ")+l+strings.Repeat(" ", max(0, w-4-lipgloss.Width(l)))+th.Rule.Render(" │"))
	}
	return strings.Join(append(out, th.Rule.Render("╰"+strings.Repeat("─", w-2)+"╯")), "\n")
}

// ---------- clave + validación ----------

type modelsMsg struct {
	models []string
	err    error
}

type keyScreen struct {
	base
	form     *huh.Form
	state    int // 0 formulario, 1 comprobando, 2 error
	err      string
	sp       spinner.Model
	fired    bool
	values   map[string]*string
	keyValue string
	retry    *choice
}

func newKeyScreen(a *App) *keyScreen {
	s := &keyScreen{base: base{3}, sp: spinner.New(spinner.WithSpinner(spinner.Dot)), values: map[string]*string{}}
	s.build(a)
	return s
}

func (s *keyScreen) build(a *App) {
	p := a.ai.prov
	var fields []huh.Field
	for _, pr := range p.Params {
		v := a.ai.params[pr.ID]
		s.values[pr.ID] = &v
		id := pr.ID
		fields = append(fields, huh.NewInput().Title(a.pick2(pr.LabelES, pr.LabelEN)).Value(s.values[id]).Validate(func(x string) error {
			if strings.TrimSpace(x) == "" {
				return fmt.Errorf("%s", a.t("obligatorio", "required"))
			}
			return nil
		}))
	}
	s.keyValue = ""
	if p.NeedsKey || p.ID == "custom" {
		title := a.t("Pega tu clave de API", "Paste your API key")
		if !p.NeedsKey {
			title = a.t("Clave de API (si tu servidor la pide)", "API key (if your server needs one)")
		}
		in := huh.NewInput().Title(title).Description(a.t("Es como una contraseña para que Lantern use este servicio. No se verá en pantalla al pegarla y se guarda solo en tu equipo.", "It is like a password that lets Lantern use this service. It will not be shown on screen when pasted and it is stored only on your computer.")).EchoMode(huh.EchoModePassword).Value(&s.keyValue)
		if p.NeedsKey {
			in = in.Validate(func(x string) error {
				if len(strings.TrimSpace(x)) < 8 {
					return fmt.Errorf("%s", a.t("la clave parece incompleta", "the key looks incomplete"))
				}
				return nil
			})
		}
		fields = append(fields, in)
	}
	if len(fields) == 0 {
		s.form = nil
		return
	}
	steps := a.pick2(strings.Join(numbered(p.StepsES), "\n"), strings.Join(numbered(p.StepsEN), "\n"))
	if p.KeyURL != "" {
		steps += "\n" + p.KeyURL
	}
	fields = append([]huh.Field{huh.NewNote().Title(a.t("Consigue tu clave de ", "Get your key from ") + p.Name).Description(steps)}, fields...)
	s.form = huh.NewForm(huh.NewGroup(fields...)).WithTheme(a.th.huh).WithShowHelp(false).WithWidth(a.width())
}

func numbered(ss []string) []string {
	out := make([]string, len(ss))
	for i, s := range ss {
		out[i] = fmt.Sprintf("%d. %s", i+1, s)
	}
	return out
}

func (s *keyScreen) Init(a *App) tea.Cmd {
	if s.form == nil {
		s.state = 1
		return tea.Batch(s.sp.Tick, s.check(a))
	}
	a.ai.openKeyPage(false) // la página donde se crea la clave, solo la primera vez
	return s.form.Init()
}

func (s *keyScreen) check(a *App) tea.Cmd {
	for k, v := range s.values {
		a.ai.params[k] = strings.TrimSpace(*v)
	}
	a.ai.key = strings.TrimSpace(s.keyValue)
	ep := a.ai.endpoint()
	filter := a.ai.prov.ModelFilter
	ctx := a.ctx
	return func() tea.Msg {
		c, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		m, err := ep.ListModels(c, filter)
		if err == nil && len(m) == 0 {
			err = fmt.Errorf("no hay modelos disponibles (¿has descargado alguno?)")
		}
		return modelsMsg{m, err}
	}
}

func (s *keyScreen) Typing() bool {
	if s.form == nil || s.state != 0 {
		return false
	}
	_, ok := s.form.GetFocusedField().(*huh.Input)
	return ok
}

func (s *keyScreen) NoBack() {}

func (s *keyScreen) Update(a *App, msg tea.Msg) tea.Cmd {
	switch m := msg.(type) {
	case spinner.TickMsg:
		if s.state == 1 {
			var c tea.Cmd
			s.sp, c = s.sp.Update(m)
			return c
		}
	case modelsMsg:
		if m.err != nil {
			s.state, s.err = 2, ai.Explain(m.err, a.es(), a.ai.prov.KeyURL)
			s.retry = newChoice([]item{{title: a.t("Reintentar con otra clave", "Retry with another key")}, {title: a.t("Elegir otro proveedor", "Choose another provider")}}, 0)
			return nil
		}
		a.ai.models = m.models
		return a.replace(newModelScreen(a))
	}
	switch s.state {
	case 2:
		if s.retry.update(msg) {
			if s.retry.sel == 1 {
				return a.back()
			}
			s.state, s.fired = 0, false
			s.build(a)
			if s.form == nil {
				return a.back()
			}
			return s.form.Init()
		}
	case 0:
		if k, ok := msg.(tea.KeyPressMsg); ok {
			switch k.String() {
			case "esc":
				return a.back()
			case "ctrl+o":
				a.ai.openKeyPage(true)
				return nil
			case "o": // con el campo vacío no es texto: reabre la página de la clave
				if f := s.form.GetFocusedField(); f != nil && f.GetValue() == "" {
					a.ai.openKeyPage(true)
					return nil
				}
			}
		}
		if _, ok := msg.(tea.MouseMsg); ok {
			return nil
		}
		_, cmd := s.form.Update(msg)
		if s.form.State == huh.StateCompleted && !s.fired {
			s.fired = true
			s.state = 1
			return tea.Batch(cmd, s.sp.Tick, s.check(a))
		}
		return cmd
	}
	return nil
}

func (s *keyScreen) View(a *App, w, h int) string {
	switch s.state {
	case 1:
		return s.sp.View() + " " + a.t("Comprobando la clave y buscando modelos…", "Checking the key and listing models…")
	case 2:
		msg := a.th.Bad.Render(a.t("No se pudo validar la clave.", "Could not validate the key.")) + "\n" + wrap(s.err, w)
		s.retry.Y0 = strings.Count(msg, "\n") + 2
		return msg + "\n\n" + s.retry.view(a.th, w, 4, false)
	}
	return s.form.View()
}

func (s *keyScreen) Keys(a *App) [][2]string {
	if s.state != 0 {
		return [][2]string{{"↑↓", a.t("elegir", "move")}, {"enter", a.t("continuar", "continue")}, {"q", a.t("salir", "quit")}}
	}
	ks := [][2]string{{"enter", a.t("continuar", "continue")}, {"esc", a.t("atrás", "back")}, {"ctrl+c", a.t("salir", "quit")}}
	if a.ai.prov.KeyURL != "" {
		ks = append([][2]string{{"o", a.t("abrir la página de la clave", "open the key page")}}, ks...)
	}
	return ks
}

func (s *keyScreen) Help(a *App) string {
	return a.t("Se ha abierto en tu navegador la página donde se crea la clave. Cópiala y pégala aquí: no se verá en pantalla. Se guarda solo en el archivo lantern.env de tu equipo (permisos 600).",
		"The page where the key is created opened in your browser. Copy it and paste it here: it will not be shown. It is stored only in lantern.env on your machine (mode 600).")
}

// ---------- modelo ----------

func newModelScreen(a *App) screen {
	def, warn := a.ai.prov.Model, ""
	for _, m := range a.ai.models {
		if m == def {
			goto found
		}
	}
	if def != "" { // el recomendado ya no existe en este proveedor: se avisa y se preselecciona otro
		warn = a.t(" El recomendado ("+def+") ya no existe; he preseleccionado "+a.ai.models[0]+".", " The recommended one ("+def+") no longer exists; I preselected "+a.ai.models[0]+".")
	}
	def = a.ai.models[0]
found:
	a.ai.model = def
	opts := make([]huh.Option[string], len(a.ai.models))
	for i, m := range a.ai.models {
		label := m
		if m == a.ai.prov.Model {
			label += a.t("  (recomendado)", "  (recommended)")
		}
		opts[i] = huh.NewOption(label, m)
	}
	f := huh.NewForm(huh.NewGroup(huh.NewSelect[string]().Title(a.t("Elige el modelo", "Choose the model")).
		Description(a.t("Escribe / para filtrar la lista.", "Type / to filter the list.")).
		Options(opts...).Filtering(true).Height(12).Value(&a.ai.model)))
	return newForm(a, 3, a.t("Hay "+fmt.Sprint(len(a.ai.models))+" modelos disponibles. La clave se comprobará con una prueba.", fmt.Sprint(len(a.ai.models))+" models available. The key will be checked with a test.")+warn, f,
		func(a *App) tea.Cmd { return a.replace(newTestScreen(a)) })
}

// ---------- prueba de chat ----------

type chatMsg struct {
	text string
	err  error
}

type testScreen struct {
	base
	sp     spinner.Model
	done   bool
	text   string
	err    error
	choice *choice
	t0     time.Time
	took   time.Duration
}

func newTestScreen(a *App) *testScreen {
	return &testScreen{base: base{3}, sp: spinner.New(spinner.WithSpinner(spinner.Dot))}
}

func (s *testScreen) NoBack() {}
func (s *testScreen) Init(a *App) tea.Cmd {
	ep, model, ctx := a.ai.endpoint(), a.ai.model, a.ctx
	s.t0 = time.Now()
	return tea.Batch(s.sp.Tick, func() tea.Msg {
		c, cancel := context.WithTimeout(ctx, 60*time.Second)
		defer cancel()
		t, err := ep.Chat(c, model, "Responde solo con la palabra: listo")
		return chatMsg{t, err}
	})
}

func (s *testScreen) Update(a *App, msg tea.Msg) tea.Cmd {
	switch m := msg.(type) {
	case spinner.TickMsg:
		if !s.done {
			var c tea.Cmd
			s.sp, c = s.sp.Update(m)
			return c
		}
	case chatMsg:
		s.done, s.text, s.err, s.took = true, strings.TrimSpace(m.text), m.err, time.Since(s.t0)
		first := a.t("Continuar", "Continue")
		if m.err != nil {
			first = a.t("Guardar de todos modos", "Save anyway")
		}
		s.choice = newChoice([]item{{title: first}, {title: a.t("Elegir otro modelo", "Choose another model")}, {title: a.t("Probar con otra clave", "Try another key")}, {title: a.t("Elegir otro proveedor", "Choose another provider")}}, 0)
		return nil
	}
	if s.done && s.choice.update(msg) {
		switch s.choice.sel {
		case 0:
			return a.acceptLLM()
		case 1:
			return a.replace(newModelScreen(a))
		case 2:
			return a.replace(newKeyScreen(a))
		default:
			return a.replace(newProviderScreen(a))
		}
	}
	return nil
}

func (s *testScreen) View(a *App, w, h int) string {
	if !s.done {
		return s.sp.View() + " " + a.t("Probando una respuesta corta de ", "Testing a short reply from ") + a.ai.model + "…"
	}
	sec := fmt.Sprintf("%.1f s", s.took.Seconds())
	if a.es() {
		sec = strings.Replace(sec, ".", ",", 1)
	}
	head := a.th.Done.Render("✓ ") + a.th.Title.Render(a.t("Funciona: respondió en ", "It works: replied in ")+sec) + "\n\n" +
		a.th.label(a.t("Prueba de respuesta", "Test reply")) + a.th.Muted.Render("   "+a.ai.model) + "\n" +
		a.th.box(a.th.Muted.Render(a.t("Tú", "You")+"  ")+"Responde solo con la palabra: listo\n"+a.th.Muted.Render("IA  ")+clip(s.text, w-10), w-2)
	if s.err != nil {
		head = a.th.Bad.Render("! "+a.t("La prueba falló: ", "The test failed: ")) + wrap(ai.Explain(s.err, a.es(), a.ai.prov.KeyURL), w)
	}
	s.choice.Y0 = strings.Count(head, "\n") + 2
	return head + "\n\n" + s.choice.view(a.th, w, 5, false)
}

// acceptLLM guarda el proveedor en la ranura actual y sigue con reserva o fin.
func (a *App) acceptLLM() tea.Cmd {
	l := &model.LLM{ID: a.ai.prov.ID, Format: a.ai.prov.Format, URL: a.ai.prov.Resolve(a.ai.params), Key: a.ai.key, Model: a.ai.model, Headers: a.ai.headers()}
	if a.ai.slot == 0 {
		a.cfg.LLM = l
		items := []item{{title: a.t("No, gracias", "No, thanks")}, {title: a.t("Sí, añadir un proveedor de reserva", "Yes, add a fallback provider"),
			lines: []string{a.t("Si el principal falla o llega a su límite diario, se usa este.", "If the main one fails or hits its daily limit, this one is used.")}}}
		return a.replace(&menuScreen{base: base{3}, ch: newChoice(items, 0),
			intro: func(a *App, w int) string {
				return a.th.Title.Render(a.t("¿Quieres un proveedor de reserva?", "Do you want a fallback provider?"))
			},
			pick: func(a *App, i int) tea.Cmd {
				if i == 0 {
					return a.ai.onDone(a)
				}
				a.ai.slot = 1
				return a.goTo(newProviderScreen(a))
			}})
	}
	a.cfg.LLM2 = l
	return a.ai.onDone(a)
}
