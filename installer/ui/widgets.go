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
	tag      string // identificador libre
}

// choice: lista vertical con teclado y ratón, con desplazamiento si no cabe.
type choice struct {
	items []item
	sel   int
	top   int   // primera línea visible
	hit   []int // línea visible (relativa al cuerpo) -> índice de item o -1
	Y0    int   // línea del cuerpo donde empieza la lista (la fija el llamador)
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
	for i, it := range c.items {
		if i == c.sel {
			selStart = len(all)
		}
		mark, num := "  ", ""
		if numbered && i < 9 {
			num = string(rune('1'+i)) + ". "
		}
		title := it.title
		var head string
		switch {
		case it.disabled:
			head = th.Muted.Render(mark + num + title)
		case i == c.sel:
			head = th.Sel.Render("▸ " + num + title + strings.Repeat(" ", max(0, w-4-lipgloss.Width(num+title))))
		default:
			head = th.Sub.Render(mark + num + title)
		}
		all = append(all, ln{head, i})
		for _, l := range it.lines { // se parten por palabras: la descripción es lo que ayuda a decidir
			for _, p := range strings.Split(wrap(l, w-6), "\n") {
				all = append(all, ln{"    " + th.Muted.Render(p), i})
			}
		}
		if i == c.sel {
			selEnd = len(all)
		}
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
	return lipgloss.NewStyle().Foreground(lipgloss.Color("#000000")).Background(lipgloss.Color("#FFFFFF")).Render(s)
}
