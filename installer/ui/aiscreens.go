package ui

import (
	"context"
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
	ep     ai.Endpoint
	onDone func(a *App) tea.Cmd // qué hacer al terminar todo el flujo de IA
}

func (f *aiFlow) endpoint() ai.Endpoint {
	return ai.Endpoint{Format: f.prov.Format, URL: f.prov.Resolve(f.params), Key: f.key, Headers: f.prov.Headers}
}

// toAI arranca el flujo de IA del asistente (después irá a Laya).
func (a *App) toAI() tea.Cmd {
	a.ai = aiFlow{onDone: func(a *App) tea.Cmd { return a.toLaya() }}
	a.cfg.LLM, a.cfg.LLM2 = nil, nil
	return a.goTo(aiIntro(a))
}

func aiIntro(a *App) screen {
	items := []item{
		{title: a.t("Sí, elegir un proveedor de IA", "Yes, choose an AI provider"), tag: "yes", lines: []string{a.t("Para el copiloto del DM: reglas, PNJ, resúmenes. Hay opciones gratuitas.", "For the DM copilot: rules, NPCs, summaries. Free options exist.")}},
		{title: a.t("Saltar por ahora", "Skip for now"), tag: "no", lines: []string{a.t("Lantern funciona sin IA; puedes añadirla luego desde el panel.", "Lantern works without AI; add it later from the dashboard.")}},
	}
	return &menuScreen{base: base{3}, ch: newChoice(items, 0), numbered: true,
		intro: func(a *App, w int) string {
			return a.th.Title.Render(a.t("Inteligencia artificial (opcional)", "Artificial intelligence (optional)")) + "\n" +
				wrap(a.t("Lantern puede usar un modelo de lenguaje para ayudar al DM. Tú eliges el proveedor y la clave se guarda solo en tu equipo.", "Lantern can use a language model to help the DM. You pick the provider and the key stays on your machine only."), w)
		},
		pick: func(a *App, i int) tea.Cmd {
			if items[i].tag == "no" {
				return a.ai.onDone(a)
			}
			return a.goTo(newProviderScreen(a))
		}}
}

// ---------- catálogo por pestañas ----------

var groupNames = map[string][2]string{
	"free": {"Gratis con clave", "Free with key"}, "subscription": {"Suscripciones", "Subscriptions"},
	"paid": {"API de pago", "Paid API"}, "local": {"Locales", "Local"},
}

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
	s.rebuild(a)
	return s
}

func (s *providerScreen) rebuild(a *App) {
	var its []item
	for _, p := range s.items[s.tab] {
		title := p.Name
		var lines []string
		if !p.Enabled {
			title += a.t("  (verificar condiciones)", "  (verify terms)")
		}
		lines = append(lines, a.pick2(p.CostES, p.CostEN))
		its = append(its, item{title: title, disabled: !p.Enabled, lines: lines[:1]})
	}
	s.ch = newChoice(its, 0)
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
	return a.t("← → cambian de pestaña. «Gratis con clave» no cuesta dinero pero tiene límites diarios. Claude Pro/Max y ChatGPT Plus/Pro no se pueden usar desde aplicaciones de terceros; si los tienes, usa la API de Anthropic u OpenAI (de pago por uso).",
		"← → switch tabs. “Free with key” costs nothing but has daily limits. Claude Pro/Max and ChatGPT Plus/Pro cannot be used from third-party apps; if you have them, use the Anthropic or OpenAI API (pay per use).")
}

func (s *providerScreen) Update(a *App, msg tea.Msg) tea.Cmd {
	switch m := msg.(type) {
	case tea.KeyPressMsg:
		switch m.String() {
		case "left", "h", "[":
			s.tab = (s.tab + len(s.items) - 1) % len(s.items)
			s.rebuild(a)
			return nil
		case "right", "l", "]":
			s.tab = (s.tab + 1) % len(s.items)
			s.rebuild(a)
			return nil
		}
	case tea.MouseClickMsg:
		if m.Y == 0 && m.Button == tea.MouseLeft {
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
	var tabs []string
	s.tabX = s.tabX[:0]
	x := 0
	for i, g := range ai.Groups {
		n := " " + a.pick2(groupNames[g][0], groupNames[g][1]) + " "
		s.tabX = append(s.tabX, x)
		x += lipgloss.Width(n) + 1
		if i == s.tab {
			tabs = append(tabs, a.th.Sel.Render(n))
		} else {
			tabs = append(tabs, a.th.Muted.Render(n))
		}
	}
	var detail string
	if s.ch.sel >= 0 && s.ch.sel < len(s.items[s.tab]) {
		p := s.items[s.tab][s.ch.sel]
		detail = "\n\n" + a.th.Accent.Render(p.Name) + "  " + a.th.Muted.Render(a.pick2(p.CostES, p.CostEN))
		if t := a.pick2(p.TermsES, p.TermsEN); t != "" {
			detail += "\n" + wrap(a.th.Muted.Render(a.t("Condiciones: ", "Terms: "))+t, w)
		}
		if p.Verify {
			detail += "\n" + a.th.Muted.Render(a.t("La URL de este proveedor está pendiente de verificar; si falla, revísala en su web.", "This provider's URL is pending verification; if it fails, check its website."))
		}
		if p.TosURL != "" && !p.Enabled {
			detail += "\n" + a.th.Link.Render(p.TosURL)
		}
	}
	note := "\n\n" + a.th.Muted.Render(wrap(a.t("Claude Pro/Max y ChatGPT Plus/Pro no aparecen: no se pueden usar desde apps de terceros. Usa la API de Anthropic u OpenAI.",
		"Claude Pro/Max and ChatGPT Plus/Pro are not listed: they cannot be used from third-party apps. Use the Anthropic or OpenAI API."), w))
	s.ch.Y0 = 2
	room := h - 2 - strings.Count(detail, "\n") - strings.Count(note, "\n") - 3
	return strings.Join(tabs, " ") + "\n\n" + s.ch.view(a.th, w, room, false) + detail + note
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
	opened   bool
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
		in := huh.NewInput().Title(title).EchoMode(huh.EchoModePassword).Value(&s.keyValue)
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
	fields = append([]huh.Field{huh.NewNote().Title(p.Name).Description(steps)}, fields...)
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
	cmds := []tea.Cmd{s.form.Init()}
	if !s.opened && a.ai.prov.KeyURL != "" {
		s.opened = true
		_ = platform.OpenURL(a.ai.prov.KeyURL) // abre la página donde se crea la clave
	}
	return tea.Batch(cmds...)
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
			s.state, s.err = 2, ai.Explain(m.err, a.es())
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
		if k, ok := msg.(tea.KeyPressMsg); ok && k.String() == "esc" {
			return a.back()
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
		s.retry.Y0 = strings.Count(a.th.Bad.Render(s.err), "\n") + 2
		return a.th.Bad.Render(a.t("No se pudo validar: ", "Could not validate: ")) + wrap(s.err, w) + "\n\n" + s.retry.view(a.th, w, 4, false)
	}
	return s.form.View()
}

func (s *keyScreen) Help(a *App) string {
	return a.t("Se ha abierto en tu navegador la página donde se crea la clave. Cópiala y pégala aquí: no se verá en pantalla. Se guarda solo en el archivo lantern.env de tu equipo (permisos 600).",
		"The page where the key is created opened in your browser. Copy it and paste it here: it will not be shown. It is stored only in lantern.env on your machine (mode 600).")
}

// ---------- modelo ----------

func newModelScreen(a *App) screen {
	def := a.ai.prov.Model
	for _, m := range a.ai.models {
		if m == def {
			goto found
		}
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
	return newForm(a, 3, a.t("Clave correcta. Hay "+fmt.Sprint(len(a.ai.models))+" modelos disponibles.", "Key accepted. "+fmt.Sprint(len(a.ai.models))+" models available."), f,
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
}

func newTestScreen(a *App) *testScreen {
	return &testScreen{base: base{3}, sp: spinner.New(spinner.WithSpinner(spinner.Dot))}
}

func (s *testScreen) NoBack() {}
func (s *testScreen) Init(a *App) tea.Cmd {
	ep, model, ctx := a.ai.endpoint(), a.ai.model, a.ctx
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
		s.done, s.text, s.err = true, strings.TrimSpace(m.text), m.err
		first := a.t("Continuar", "Continue")
		if m.err != nil {
			first = a.t("Guardar de todos modos", "Save anyway")
		}
		s.choice = newChoice([]item{{title: first}, {title: a.t("Elegir otro modelo", "Choose another model")}, {title: a.t("Elegir otro proveedor", "Choose another provider")}}, 0)
		return nil
	}
	if s.done && s.choice.update(msg) {
		switch s.choice.sel {
		case 0:
			return a.acceptLLM()
		case 1:
			return a.replace(newModelScreen(a))
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
	head := a.th.Good.Render("✓ " + a.t("Funciona. Respuesta: ", "It works. Reply: ") + clip(s.text, w-30))
	if s.err != nil {
		head = a.th.Bad.Render("✗ "+a.t("La prueba falló: ", "The test failed: ")) + wrap(ai.Explain(s.err, a.es()), w)
	}
	s.choice.Y0 = strings.Count(head, "\n") + 2
	return head + "\n\n" + s.choice.view(a.th, w, 5, false)
}

// acceptLLM guarda el proveedor en la ranura actual y sigue con reserva o fin.
func (a *App) acceptLLM() tea.Cmd {
	l := &model.LLM{ID: a.ai.prov.ID, Format: a.ai.prov.Format, URL: a.ai.prov.Resolve(a.ai.params), Key: a.ai.key, Model: a.ai.model, Headers: a.ai.prov.Headers}
	if a.ai.slot == 0 {
		a.cfg.LLM = l
		items := []item{{title: a.t("No, gracias", "No, thanks")}, {title: a.t("Sí, añadir un proveedor de reserva", "Yes, add a fallback provider"),
			lines: []string{a.t("Si el principal falla o llega a su límite diario, se usa este.", "If the main one fails or hits its daily limit, this one is used.")}}}
		return a.replace(&menuScreen{base: base{3}, ch: newChoice(items, 0), numbered: true,
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

// ---------- Laya ----------

func (a *App) toLaya() tea.Cmd {
	if a.cfg.Docker {
		return a.toTable()
	}
	free := float64(platform.FreeDisk(a.cfg.DataDir)) / (1 << 30)
	items := []item{
		{title: a.t("Instalar Laya (≈1,2 GB, 5–15 min)", "Install Laya (≈1.2 GB, 5–15 min)"), tag: "yes"},
		{title: a.t("Saltar por ahora", "Skip for now"), tag: "no"},
	}
	return a.goTo(&menuScreen{base: base{3}, ch: newChoice(items, 1), numbered: true,
		intro: func(a *App, w int) string {
			return a.th.Title.Render(a.t("Laya: IA local para el turno de los monstruos", "Laya: local AI for monster turns")) + "\n" +
				wrap(a.t("Laya decide qué hacen los monstruos en combate y funciona en tu CPU, sin enviar nada a Internet. Descarga Python, PyTorch (CPU) y el modelo: unos 1,2 GB y entre 5 y 15 minutos según tu conexión. ",
					"Laya decides what monsters do in combat and runs on your CPU, sending nothing to the Internet. It downloads Python, PyTorch (CPU) and the model: about 1.2 GB and 5–15 minutes depending on your connection. ")+
					fmt.Sprintf(a.t("Espacio libre: %.1f GB.", "Free space: %.1f GB."), free), w)
		},
		pick: func(a *App, i int) tea.Cmd {
			a.cfg.Laya = items[i].tag == "yes"
			return a.toTable()
		}})
}
