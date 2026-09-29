// Package ui: asistente y panel de Lantern (Bubble Tea v2 + Lip Gloss + Huh).
package ui

import (
	"image/color"
	"os"

	"charm.land/huh/v2"
	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/term"
)

// theme: día = pergamino/oro/bermellón/lapislázuli; noche = cuero/marfil/oro. No fija el fondo: respeta el del terminal.
type theme struct {
	dark, mono                                      bool
	Title, Sub, Muted, Accent, Good, Bad, Link, Sel lipgloss.Style
	Box, Key, Done, Todo, Cur                       lipgloss.Style
	huh                                             huh.Theme
}

func hasDark() bool {
	if !term.IsTerminal(os.Stdin.Fd()) || !term.IsTerminal(os.Stdout.Fd()) {
		return true
	}
	return lipgloss.HasDarkBackground(os.Stdin, os.Stdout)
}

func newTheme(dark, mono bool) theme {
	t := theme{dark: dark, mono: mono}
	s := lipgloss.NewStyle
	if mono {
		t.Title, t.Sub, t.Muted, t.Accent = s().Bold(true), s(), s().Faint(true), s().Bold(true)
		t.Good, t.Bad, t.Link, t.Sel = s(), s().Bold(true), s().Underline(true), s().Reverse(true).Bold(true)
		t.Box = s().Border(lipgloss.NormalBorder()).Padding(0, 1)
		t.Key, t.Done, t.Todo, t.Cur = s().Bold(true), s(), s().Faint(true), s().Bold(true)
		t.huh = huh.ThemeFunc(huh.ThemeBase)
		return t
	}
	ld := lipgloss.LightDark(dark)
	c := func(day, night string) color.Color { return ld(lipgloss.Color(day), lipgloss.Color(night)) }
	ink, gold := c("#3B2F22", "#EDE4D0"), c("#9A6F00", "#D4AF37")
	muted, verm, lapis := c("#7A6A55", "#A39682"), c("#B3372B", "#E5604B"), c("#26619C", "#7FAEE0")
	sel := c("#F3E9D2", "#3B2A1E") // pergamino / cuero
	t.Title = s().Bold(true).Foreground(gold)
	t.Sub = s().Foreground(ink)
	t.Muted = s().Foreground(muted)
	t.Accent = s().Foreground(gold)
	t.Good = s().Foreground(lapis)
	t.Bad = s().Foreground(verm).Bold(true)
	t.Link = s().Foreground(lapis).Underline(true)
	t.Sel = s().Foreground(gold).Background(sel).Bold(true)
	t.Box = s().Border(lipgloss.RoundedBorder()).BorderForeground(gold).Padding(0, 1)
	t.Key = s().Foreground(gold).Bold(true)
	t.Done, t.Todo, t.Cur = s().Foreground(lapis), s().Foreground(muted), s().Foreground(gold).Bold(true)
	t.huh = huh.ThemeFunc(func(isDark bool) *huh.Styles {
		h := huh.ThemeBase(isDark)
		h.Focused.Title = h.Focused.Title.Foreground(gold).Bold(true)
		h.Focused.NoteTitle = h.Focused.NoteTitle.Foreground(gold).Bold(true)
		h.Focused.Description = h.Focused.Description.Foreground(muted)
		h.Focused.Base = h.Focused.Base.BorderForeground(gold)
		h.Focused.ErrorMessage = h.Focused.ErrorMessage.Foreground(verm)
		h.Focused.ErrorIndicator = h.Focused.ErrorIndicator.Foreground(verm)
		h.Focused.SelectSelector = h.Focused.SelectSelector.Foreground(gold)
		h.Focused.Option = h.Focused.Option.Foreground(ink)
		h.Focused.SelectedOption = h.Focused.SelectedOption.Foreground(lapis)
		h.Focused.Directory = h.Focused.Directory.Foreground(lapis)
		h.Focused.File = h.Focused.File.Foreground(ink)
		h.Focused.FocusedButton = h.Focused.FocusedButton.Foreground(sel).Background(gold)
		h.Focused.BlurredButton = h.Focused.BlurredButton.Foreground(ink).Background(sel)
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
