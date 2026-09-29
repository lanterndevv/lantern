// Package ui: asistente y panel de Lantern (Bubble Tea v2 + Lip Gloss + Huh).
package ui

import (
	"image/color"

	"charm.land/huh/v2"
	"charm.land/lipgloss/v2"
)

// theme: paleta «Grimorio» (noche) / «Libro de horas» (día). El oro es solo para lo activo, el bermellón para la acción
// principal y los avisos, el lapislázuli para las URL y el verde salvia para el ✓. No fija el fondo: respeta el del terminal.
type theme struct {
	dark, mono                                      bool
	Title, Sub, Muted, Accent, Good, Bad, Link, Sel lipgloss.Style
	Box, Key, Done, Todo, Cur                       lipgloss.Style
	Soft, Rule, Btn, Now, Gold                      lipgloss.Style // texto secundario, líneas, botón principal, paso actual, oro de texto
	dim, gold                                       color.Color    // borde tenue y oro para los bordes dibujados a mano
	huh                                             huh.Theme
}

func newTheme(dark, mono bool) theme {
	t := theme{dark: dark, mono: mono}
	s := lipgloss.NewStyle
	if mono {
		t.Title, t.Sub, t.Muted, t.Accent = s().Bold(true), s(), s().Faint(true), s().Faint(true)
		t.Good, t.Bad, t.Link, t.Sel = s(), s().Bold(true), s().Underline(true), s().Reverse(true).Bold(true)
		t.Box = s().Border(lipgloss.RoundedBorder()).Padding(0, 1)
		t.Key, t.Done, t.Todo, t.Cur = s().Bold(true), s(), s().Faint(true), s().Bold(true)
		t.Soft, t.Rule, t.Btn, t.Now, t.Gold = s(), s().Faint(true), s().Reverse(true).Bold(true), s().Bold(true), s().Bold(true)
		t.huh = huh.ThemeFunc(huh.ThemeBase)
		return t
	}
	ld := lipgloss.LightDark(dark)
	c := func(day, night string) color.Color { return ld(lipgloss.Color(day), lipgloss.Color(night)) }
	ink, gold, muted, soft := c("#4A3524", "#F0E2C0"), c("#8A6410", "#E8C766"), c("#6E5A44", "#9A8666"), c("#5A4330", "#CDB892")
	verm, lapis, sage := c("#B23A1E", "#F07A5A"), c("#2F5FB3", "#4F86E0"), c("#3F6B2A", "#9CC98A")
	sel, dim := c("#F1E8D3", "#2A2016"), c("#B8A27C", "#5A4834")
	t.dim, t.gold = dim, gold
	t.Title = s().Bold(true).Foreground(ink)
	t.Sub = s().Foreground(ink)
	t.Muted = s().Foreground(muted)
	t.Soft = s().Foreground(soft)
	t.Accent = s().Foreground(muted)
	t.Good = s().Foreground(sage)
	t.Bad = s().Foreground(verm).Bold(true)
	t.Link = s().Foreground(lapis).Underline(true)
	t.Sel = s().Foreground(gold).Background(sel).Bold(true)
	t.Box = s().Border(lipgloss.RoundedBorder()).BorderForeground(dim).Padding(0, 1)
	t.Key = s().Foreground(ink).Bold(true)
	t.Done, t.Todo, t.Cur, t.Gold = s().Foreground(sage), s().Foreground(muted), s().Foreground(gold).Bold(true), s().Foreground(gold)
	t.Rule = s().Foreground(c("#CDBB98", "#4A3C2C"))
	t.Btn = s().Bold(true).Background(verm).Foreground(c("#FFFDF8", "#14100C"))
	t.Now = s().Bold(true).Foreground(gold)
	if !dark { // el oro de texto es demasiado oscuro para verse; se usa el #E8C766 como relleno con texto sepia
		t.Now = s().Bold(true).Foreground(lipgloss.Color("#4A3524")).Background(lipgloss.Color("#E8C766"))
	}
	t.huh = huh.ThemeFunc(func(isDark bool) *huh.Styles {
		h := huh.ThemeBase(isDark)
		h.Focused.Title = h.Focused.Title.Foreground(ink).Bold(true)
		h.Focused.NoteTitle = h.Focused.NoteTitle.Foreground(ink).Bold(true)
		h.Focused.Description = h.Focused.Description.Foreground(muted)
		h.Focused.Base = h.Focused.Base.BorderForeground(dim)
		h.Focused.ErrorMessage = h.Focused.ErrorMessage.Foreground(verm)
		h.Focused.ErrorIndicator = h.Focused.ErrorIndicator.Foreground(verm)
		h.Focused.SelectSelector = h.Focused.SelectSelector.Foreground(gold)
		h.Focused.Option = h.Focused.Option.Foreground(ink)
		h.Focused.SelectedOption = h.Focused.SelectedOption.Foreground(gold)
		h.Focused.Directory = h.Focused.Directory.Foreground(gold)
		h.Focused.File = h.Focused.File.Foreground(ink)
		h.Focused.FocusedButton = h.Focused.FocusedButton.Foreground(ink).Background(sel)
		h.Focused.BlurredButton = h.Focused.BlurredButton.Foreground(muted)
		h.Focused.TextInput.Cursor = h.Focused.TextInput.Cursor.Foreground(gold)
		h.Focused.TextInput.Prompt = h.Focused.TextInput.Prompt.Foreground(gold)
		h.Focused.TextInput.Text = h.Focused.TextInput.Text.Foreground(ink)
		h.Blurred = h.Focused
		h.Blurred.Base = h.Focused.Base.BorderStyle(lipgloss.HiddenBorder())
		h.Blurred.NextIndicator, h.Blurred.PrevIndicator = lipgloss.NewStyle(), lipgloss.NewStyle()
		h.Group.Title, h.Group.Description = h.Focused.Title, h.Focused.Description
		return h
	})
	return t
}
