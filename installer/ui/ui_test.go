package ui

import (
	"bytes"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/exp/teatest/v2"

	"lantern/installer/engine"
	"lantern/installer/model"
	"lantern/installer/platform"
)

func enter() tea.KeyPressMsg { return tea.KeyPressMsg{Code: tea.KeyEnter} }
func down() tea.KeyPressMsg  { return tea.KeyPressMsg{Code: tea.KeyDown} }

func waitFor(t *testing.T, tm *teatest.TestModel, s string) {
	t.Helper()
	var last []byte
	err := func() error {
		var buf bytes.Buffer
		err := tryWait(tm, &buf, s)
		last = buf.Bytes()
		return err
	}()
	if err != nil {
		t.Fatalf("no apareció %q; última pantalla:\n%s", s, tail(last))
	}
}

func tail(b []byte) string {
	if len(b) > 1500 {
		b = b[len(b)-1500:]
	}
	return string(b)
}

func tryWait(tm *teatest.TestModel, buf *bytes.Buffer, s string) error {
	return waitOutput(tm.Output(), buf, s)
}

func waitOutput(r io.Reader, buf *bytes.Buffer, s string) error {
	deadline := time.Now().Add(20 * time.Second)
	tmp := make([]byte, 8192)
	for time.Now().Before(deadline) {
		n, _ := r.Read(tmp)
		buf.Write(tmp[:n])
		if strings.Contains(buf.String(), s) {
			return nil
		}
		time.Sleep(20 * time.Millisecond)
	}
	return io.ErrNoProgress
}

func freePort() int {
	l, _ := net.Listen("tcp", "127.0.0.1:0")
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

// Recorre el asistente en modo Red local, sin IA, hasta el resumen; con el binario SEA presente, instala de verdad.
func TestWizardFlow(t *testing.T) {
	dir := t.TempDir()
	bin, _ := filepath.Abs("../../dist-bin/lantern-server-linux-x64")
	_, binErr := os.Stat(bin)
	base := model.Config{DataDir: dir, NoService: true, Port: freePort(), Lang: "es"}
	if binErr == nil {
		base.ServerBin = bin
	}
	app := New(Options{Paths: platform.Paths{Data: dir}, Base: base, Lang: "es"})
	tm := teatest.NewTestModel(t, app, teatest.WithInitialTermSize(100, 30))

	waitFor(t, tm, "Bienvenida a Lantern")
	tm.Send(enter()) // idioma español
	waitFor(t, tm, "¿Dónde quieres jugar?")
	tm.Send(tea.KeyPressMsg{Code: '4', Text: "4"}) // Red local
	waitFor(t, tm, "Instalar en este equipo")
	tm.Send(enter())
	waitFor(t, tm, "Inteligencia artificial")
	tm.Send(down())
	tm.Send(enter()) // saltar IA
	waitFor(t, tm, "Laya")
	tm.Send(enter()) // saltar Laya (preseleccionado)
	waitFor(t, tm, "DM")
	tm.Send(enter()) // nombre de DM por defecto
	tm.Send(enter()) // título
	waitFor(t, tm, "importar")
	tm.Send(enter()) // mesa vacía
	waitFor(t, tm, "Lantern Link")
	tm.Send(enter())
	waitFor(t, tm, "Todo listo para instalar")
	if binErr != nil {
		t.Log("sin binario SEA: el recorrido termina en el resumen")
		return
	}
	tm.Send(enter())
	waitFor(t, tm, "Lantern está listo")
	st, ok := engine.LoadState(platform.Paths{Data: dir})
	if !ok || st.Code == "" || st.Mode != "lan" {
		t.Fatalf("estado tras instalar: %+v", st)
	}
	engine.Uninstall(platform.Paths{Data: dir}, st, true)
}

func TestQRAndNoColor(t *testing.T) {
	q := renderQR("https://ejemplo.trycloudflare.com/?code=ABC123", true, true)
	if strings.Contains(q, "\x1b[") {
		t.Error("NO_COLOR: el QR no debe llevar secuencias de color")
	}
	if n := strings.Count(q, "\n"); n < 10 || n > 30 {
		t.Errorf("alto del QR inesperado: %d", n)
	}
	th := newTheme(true, true)
	if strings.Contains(th.Title.Render("x"), "\x1b[3") { // colores 30-37/38
		t.Error("tema mono sin colores")
	}
}

func TestRebase(t *testing.T) {
	if got := rebase("https://a.trycloudflare.com/?code=X", "https://b.trycloudflare.com"); got != "https://b.trycloudflare.com/?code=X" {
		t.Errorf("rebase = %s", got)
	}
}

func TestValidHost(t *testing.T) {
	for _, ok := range []string{"mesa.midominio.com", "a.b"} {
		if validHost(ok) != nil {
			t.Errorf("%s debería valer", ok)
		}
	}
	for _, bad := range []string{"https://x.com", "sinpunto", "a b.com", "x.com/ruta"} {
		if validHost(bad) == nil {
			t.Errorf("%s no debería valer", bad)
		}
	}
}

func TestWrap(t *testing.T) {
	got := wrap("• uno dos tres cuatro\nhttps://ejemplo.com/una/url/larguisima", 12)
	for _, l := range strings.Split(got, "\n") {
		if len([]rune(l)) > 12 {
			t.Errorf("línea de %d columnas: %q", len([]rune(l)), l)
		}
	}
	if !strings.Contains(got, "\n  tres") {
		t.Errorf("la viñeta no sangra la continuación:\n%s", got)
	}
}
