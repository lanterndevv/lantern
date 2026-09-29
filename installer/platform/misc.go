package platform

import (
	"os"
	"os/exec"
	"runtime"
	"strings"
)

// OpenURL abre una URL en el navegador predeterminado.
func OpenURL(u string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", u).Start()
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", u).Start()
	}
	return exec.Command("xdg-open", u).Start()
}

// CopyText copia s con la herramienta del sistema (pbcopy, wl-copy, xclip, xsel, clip.exe) y dice si alguna funcionó.
// Sin ninguna, la interfaz sigue enviando OSC 52 y enseña el texto para seleccionarlo.
func CopyText(s string) bool {
	tools := [][]string{{"pbcopy"}, {"clip.exe"}, {"clip"}}
	if os.Getenv("WAYLAND_DISPLAY") != "" {
		tools = append(tools, []string{"wl-copy"})
	}
	if os.Getenv("DISPLAY") != "" {
		tools = append(tools, []string{"xclip", "-selection", "clipboard"}, []string{"xsel", "-ib"})
	}
	for _, t := range tools {
		if p, err := exec.LookPath(t[0]); err == nil {
			c := exec.Command(p, t[1:]...)
			c.Stdin = strings.NewReader(s)
			if c.Run() == nil {
				return true
			}
		}
	}
	return false
}
