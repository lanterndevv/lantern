package ui

import (
	"strings"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
	"rsc.io/qr"
)

// item de una lista de opciones (tarjeta): título + líneas de detalle.
type item struct {
	title    string
	lines    []string
	disabled bool
	danger   bool     // acción destructiva: se pinta en bermellón
	tag      string   // identificador libre
	right    string   // a la derecha del título; lo que sigue a « · » va atenuado
	pros     []string // ventajas y desventajas (solo con choice.card)
	cons     []string
}

// choice: lista vertical con teclado y ratón, con desplazamiento si no cabe.
type choice struct {
	items []item
	sel   int
	top   int   // primera línea visible
	hit   []int // línea visible (relativa al cuerpo) -> índice de item o -1
	Y0    int   // línea del cuerpo donde empieza la lista (la fija el llamador)
	radio bool  // ◉/○ delante de cada opción
	card  bool  // la opción elegida se dibuja en una caja dorada con sus pros y contras
}

func newChoice(items []item, sel int) *choice { return &choice{items: items, sel: sel} }

// update devuelve true si se ha elegido un elemento.
func (c *choice) update(msg tea.Msg) bool {
	move := func(d int) {
		for i := c.sel + d; i >= 0 && i < len(c.items); i += d {
			if !c.items[i].disabled {
				c.sel = i
				return
			}
		}
	}
	switch m := msg.(type) {
	case tea.KeyPressMsg:
		switch k := m.String(); k {
		case "up", "k", "shift+tab", "left", "h":
			move(-1)
		case "down", "j", "tab", "right", "l":
			move(1)
		case "home":
			c.sel = -1
			move(1)
		case "end":
			c.sel = len(c.items)
			move(-1)
		case "enter", "space":
			return c.sel >= 0 && c.sel < len(c.items) && !c.items[c.sel].disabled
		default:
			if len(k) == 1 && k[0] >= '1' && k[0] <= '9' {
				if i := int(k[0] - '1'); i < len(c.items) && !c.items[i].disabled {
					c.sel = i
					return true
				}
			}
		}
	case tea.MouseWheelMsg:
		if m.Button == tea.MouseWheelUp {
			move(-1)
		} else if m.Button == tea.MouseWheelDown {
			move(1)
		}
	case tea.MouseClickMsg:
		if m.Button == tea.MouseLeft {
			if y := m.Y - c.Y0; y >= 0 && y < len(c.hit) && c.hit[y] >= 0 && !c.items[c.hit[y]].disabled {
				c.sel = c.hit[y]
				return true
			}
		}
	}
	return false
}

func (c *choice) view(th theme, w, maxLines int, numbered bool) string {
	type ln struct {
		s  string
		it int
	}
	var all []ln
	selStart, selEnd := 0, 0
	iw := w // ancho útil de cada línea; las tarjetas gastan 2 columnas en los bordes
	if c.card {
		iw = w - 2
	}
	build := func(full bool) {
		all, selStart, selEnd = all[:0], 0, 0
		for i, it := range c.items {
			sel := i == c.sel
			if sel {
				selStart = len(all)
			}
			mark, num := "  ", ""
			switch {
			case c.radio && sel:
				mark = "▸ ◉ "
			case c.radio:
				mark = "  ○ "
			case sel:
				mark = "▸ "
			}
			if numbered && i < 9 {
				num = string(rune('1'+i)) + ". "
			}
			left := mark + num + it.title
			right, price, rest := "", "", ""
			if it.right != "" {
				price, rest, _ = strings.Cut(it.right, " · ")
				right = price
				if rest != "" {
					right += " · " + rest
				}
				right += " "
			}
			pad := strings.Repeat(" ", max(1, iw-lipgloss.Width(left)-lipgloss.Width(right)))
			var head string
			switch {
			case it.disabled:
				head = th.Muted.Render(left)
			case sel:
				head = th.Sel.Render(clip(left+pad+right, iw) + strings.Repeat(" ", max(0, iw-lipgloss.Width(left+pad+right))))
			case it.danger:
				head = th.Bad.Render(left)
			default:
				head = th.Sub.Render(left)
				if right != "" {
					head += pad + th.Title.Render(price)
					if rest != "" {
						head += th.Soft.Render(" · " + rest)
					}
					head += " "
				}
			}
			side := func(s string) string { return th.Gold.Render(s) }
			edge := func(l string) string { // borde de la tarjeta: solo la elegida lo dibuja
				if !c.card {
					return l
				}
				if sel {
					return side("│") + l + side("│")
				}
				return " " + l + " "
			}
			if c.card && sel {
				all = append(all, ln{side("╭" + strings.Repeat("─", iw) + "╮"), i})
			}
			all = append(all, ln{edge(head), i})
			for _, l := range it.lines { // se parten por palabras: la descripción es lo que ayuda a decidir
				for _, p := range strings.Split(wrap(l, w-6), "\n") {
					all = append(all, ln{"    " + th.Muted.Render(p), i})
				}
			}
			if c.card && (sel || full) {
				st := th.Soft
				if sel {
					st = th.Sub
				}
				for _, p := range procon(th, st, it, iw-6) {
					all = append(all, ln{edge("     " + p + strings.Repeat(" ", max(0, iw-5-lipgloss.Width(p)))), i})
				}
			}
			switch {
			case c.card && sel:
				all = append(all, ln{side("╰" + strings.Repeat("─", iw) + "╯"), i})
			case c.card && full && i < len(c.items)-1:
				all = append(all, ln{"", i})
			}
			if sel {
				selEnd = len(all)
			}
		}
	}
	if build(true); c.card && len(all) > maxLines {
		build(false)
	}
	if maxLines < 3 {
		maxLines = 3
	}
	if selEnd-c.top > maxLines {
		c.top = selEnd - maxLines
	}
	if selStart < c.top {
		c.top = selStart
	}
	if c.top < 0 || len(all) <= maxLines {
		c.top = 0
	}
	end := min(len(all), c.top+maxLines)
	var out []string
	c.hit = c.hit[:0]
	for _, l := range all[c.top:end] {
		out = append(out, l.s)
		c.hit = append(c.hit, l.it)
	}
	s := strings.Join(out, "\n")
	if len(all) > maxLines {
		s += "\n" + th.Muted.Render("  ↑↓ …")
	}
	return s
}

// procon dispone las ventajas (+) y las desventajas (−) de una tarjeta: en dos columnas si caben, y si no una por línea.
func procon(th theme, st lipgloss.Style, it item, w int) []string {
	col := w / 2
	var out []string
	for _, g := range []struct {
		xs   []string
		mark string
		ms   lipgloss.Style
	}{{it.pros, "+", th.Done}, {it.cons, "−", th.Bad}} {
		fits := true
		for _, x := range g.xs {
			fits = fits && lipgloss.Width(x)+4 <= col
		}
		cell := func(x string) string { return g.ms.Render(g.mark) + " " + st.Render(x) }
		for i := 0; i < len(g.xs); i++ {
			switch {
			case fits && i+1 < len(g.xs):
				out = append(out, cell(g.xs[i])+strings.Repeat(" ", col-lipgloss.Width(g.xs[i])-2)+cell(g.xs[i+1]))
				i++
			case fits:
				out = append(out, cell(g.xs[i]))
			default:
				for j, p := range strings.Split(wrap(g.xs[i], w-2), "\n") {
					if j == 0 {
						out = append(out, cell(p))
					} else {
						out = append(out, "  "+st.Render(p))
					}
				}
			}
		}
	}
	return out
}

func clip(s string, w int) string {
	if w < 4 || lipgloss.Width(s) <= w {
		return s
	}
	r := []rune(s)
	for len(r) > 0 && lipgloss.Width(string(r)) > w-1 {
		r = r[:len(r)-1]
	}
	return string(r) + "…"
}

// wrap parte el texto en líneas de ancho w (por palabras, respetando saltos).
// Las viñetas («• », «- », «1. ») y la sangría se conservan en las líneas de continuación;
// una palabra más larga que la línea (una URL, una clave) se parte a la fuerza.
func wrap(s string, w int) string {
	if w < 10 {
		return s
	}
	var out []string
	for _, para := range strings.Split(s, "\n") {
		pre, rest := bullet(para)
		ind := strings.Repeat(" ", lipgloss.Width(pre))
		room := max(1, w-len(ind))
		var lines []string
		cur := ""
		for _, word := range strings.Fields(rest) {
			switch {
			case lipgloss.Width(word) > room:
				if cur != "" {
					lines = append(lines, cur)
				}
				parts := strings.Split(ansi.Hardwrap(word, room, true), "\n")
				lines = append(lines, parts[:len(parts)-1]...)
				cur = parts[len(parts)-1]
			case cur == "":
				cur = word
			case lipgloss.Width(cur)+1+lipgloss.Width(word) > room:
				lines = append(lines, cur)
				cur = word
			default:
				cur += " " + word
			}
		}
		lines = append(lines, cur)
		for i, l := range lines {
			switch {
			case l == "":
				out = append(out, "")
			case i == 0:
				out = append(out, pre+l)
			default:
				out = append(out, ind+l)
			}
		}
	}
	return strings.Join(out, "\n")
}

// bullet separa la sangría y la viñeta de una línea («  • », «- », «3. ») del resto.
func bullet(p string) (pre, rest string) {
	n := len(p) - len(strings.TrimLeft(p, " "))
	switch t := p[n:]; {
	case strings.HasPrefix(t, "• "):
		n += len("• ")
	case strings.HasPrefix(t, "- "):
		n += 2
	default:
		k := 0
		for k < len(t) && t[k] >= '0' && t[k] <= '9' {
			k++
		}
		if k > 0 && k+1 < len(t) && (t[k] == '.' || t[k] == ')') && t[k+1] == ' ' {
			n += k + 2
		}
	}
	return p[:n], p[n:]
}

// styled aplica un estilo a cada línea por separado (un texto partido no arrastra colores entre líneas).
func styled(st lipgloss.Style, s string) string {
	ls := strings.Split(s, "\n")
	for i, l := range ls {
		if l != "" {
			ls[i] = st.Render(l)
		}
	}
	return strings.Join(ls, "\n")
}

// renderQR dibuja el QR con medios bloques (2 filas por línea). Con colores: negro sobre blanco.
// Sin colores (NO_COLOR): los módulos oscuros se dibujan con el glifo o con espacio según el fondo del terminal.
func renderQR(text string, mono, termDark bool) string {
	c, err := qr.Encode(text, qr.L)
	if err != nil {
		return ""
	}
	const quiet = 2
	n := c.Size + 2*quiet
	flip := mono && termDark
	dark := func(x, y int) bool {
		x, y = x-quiet, y-quiet
		return (x >= 0 && y >= 0 && x < c.Size && y < c.Size && c.Black(x, y)) != flip
	}
	var b strings.Builder
	for y := 0; y < n; y += 2 {
		for x := 0; x < n; x++ {
			switch top, bot := dark(x, y), dark(x, y+1); {
			case top && bot:
				b.WriteString("█")
			case top:
				b.WriteString("▀")
			case bot:
				b.WriteString("▄")
			default:
				b.WriteString(" ")
			}
		}
		b.WriteString("\n")
	}
	s := strings.TrimRight(b.String(), "\n")
	if mono {
		return s
	}
	if !termDark { // sepia sobre papel claro
		return lipgloss.NewStyle().Foreground(lipgloss.Color("#2A1D12")).Background(lipgloss.Color("#FFFDF8")).Render(s)
	}
	return lipgloss.NewStyle().Foreground(lipgloss.Color("#14100C")).Background(lipgloss.Color("#F0E2C0")).Render(s) // tinta sobre marfil
}

// button: botón principal (bermellón) y su pista.
func (th theme) button(label, hint string) string {
	return th.Btn.Render("  "+label+"  ▸  ") + "   " + th.Muted.Render(hint)
}

// label: rótulo de sección en mayúsculas atenuadas.
func (th theme) label(s string) string { return th.Muted.Render(strings.ToUpper(s)) }

// box dibuja s dentro de una caja redondeada de ancho w (el texto ya debe caber).
func (th theme) box(s string, w int) string { return th.Box.Width(w).Render(s) }

// bar: barra de progreso de w columnas (oro lo hecho, atenuado lo que falta).
func (th theme) bar(frac float64, w int) string {
	n := max(0, min(w, int(frac*float64(w)+0.5)))
	return th.Cur.Render(strings.Repeat("█", n)) + th.Rule.Render(strings.Repeat("░", w-n))
}

// keyHints: barra de atajos («tecla» en negrita, su descripción atenuada). Si no caben en w, se estrecha la separación
// y luego se quitan los penúltimos (el último, «q salir», se conserva).
func (th theme) keyHints(ks [][2]string, w int) string {
	for {
		for _, sep := range []string{"  ·  ", " · "} {
			var parts []string
			for _, k := range ks {
				parts = append(parts, th.Key.Render(k[0])+" "+th.Muted.Render(k[1]))
			}
			if s := strings.Join(parts, th.Rule.Render(sep)); lipgloss.Width(s) <= w || len(ks) < 3 {
				return ansi.Truncate(s, w, "…")
			}
		}
		ks = append(ks[:len(ks)-2:len(ks)-2], ks[len(ks)-1])
	}
}

// Letras de bloque de 3×5 para el código de la mesa (alfabeto del código: sin 0/O/1/I/L).
const glyphs = `
A .#. #.# ### #.# #.#
B ##. #.# ##. #.# ##.
C .## #.. #.. #.. .##
D ##. #.# #.# #.# ##.
E ### #.. ##. #.. ###
F ### #.. ##. #.. #..
G .## #.. #.# #.# .##
H #.# #.# ### #.# #.#
J ..# ..# ..# #.# .#.
K #.# #.# ##. #.# #.#
M #.# ### ### #.# #.#
N ##. #.# #.# #.# #.#
P ##. #.# ##. #.. #..
Q .#. #.# #.# ### .##
R ##. #.# ##. #.# #.#
S .## #.. .#. ..# ##.
T ### .#. .#. .#. .#.
U #.# #.# #.# #.# ###
V #.# #.# #.# #.# .#.
W #.# #.# ### ### #.#
X #.# #.# .#. #.# #.#
Y #.# #.# .#. .#. .#.
Z ### ..# .#. #.. ###
2 ##. ..# .#. #.. ###
3 ##. ..# .#. ..# ##.
4 #.# #.# ### ..# ..#
5 ### #.. ##. ..# ##.
6 .## #.. ### #.# ###
7 ### ..# .#. .#. .#.
8 ### #.# ### #.# ###
9 ### #.# ### ..# ##.
- ... ... ### ... ...
`

// blockText escribe s con letras de bloque (cada punto son dos columnas); devuelve 5 líneas.
func blockText(s string) []string {
	font := map[rune][]string{}
	for _, l := range strings.Split(strings.TrimSpace(glyphs), "\n") {
		f := strings.Fields(l)
		font[[]rune(f[0])[0]] = f[1:]
	}
	rows := make([]string, 5)
	for _, r := range strings.ToUpper(s) {
		g, ok := font[r]
		if !ok {
			continue
		}
		for y := range rows {
			if rows[y] != "" {
				rows[y] += " "
			}
			rows[y] += strings.NewReplacer("#", "██", ".", "  ").Replace(g[y])
		}
	}
	return rows
}
