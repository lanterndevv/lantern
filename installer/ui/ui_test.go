package ui

import (
	"bytes"
	"io"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"
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

	waitFor(t, tm, "Tu mesa de rol")
	tm.Send(enter()) // idioma español
	waitFor(t, tm, "¿Dónde quieres jugar?")
	tm.Send(tea.KeyPressMsg{Code: '4', Text: "4"}) // Red local
	waitFor(t, tm, "Instalar en este equipo")
	tm.Send(enter())
	waitFor(t, tm, "¿Qué IA quieres")
	for range 4 {
		tm.Send(tea.KeyPressMsg{Code: tea.KeyTab}) // hasta la pestaña «Ninguna»
	}
	tm.Send(enter()) // seguir sin IA
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
	waitFor(t, tm, "Tu mesa está lista")
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

var sgrColor = regexp.MustCompile(`\x1b\[(?:[0-9]*;)*(?:3[0-8]|4[0-8]|9[0-7]|10[0-7])(?:;|m)`)

// Con NO_COLOR ninguna pantalla emite colores, y la barra de pasos lleva los siete nombres en orden.
func TestNoColorScreens(t *testing.T) {
	a := New(Options{Paths: platform.Paths{Data: t.TempDir()}, Base: model.Config{Lang: "es"}, Lang: "es"})
	a.th = newTheme(true, true)
	for name, s := range map[string]screen{"bienvenida": newWelcome(a), "donde": modeMenu(a), "ia": newProviderScreen(a), "listo": newDone(a, "")} {
		a.cur, a.result = s, model.Result{Code: "K7Q4ZP", InviteURL: "https://x.trycloudflare.com/?code=K7Q4ZP"}
		out := a.View().Content
		if m := sgrColor.FindString(out); m != "" {
			t.Errorf("%s: secuencia de color %q con NO_COLOR", name, m)
		}
	}
	a.th = newTheme(true, false)
	bar := ansi.Strip(a.stepBar())
	last := -1
	for _, n := range []string{"Bienvenida", "Dónde", "Enlace", "IA", "Tu mesa", "Instalar", "Listo"} {
		i := strings.Index(bar, n)
		if i <= last {
			t.Fatalf("la barra de pasos no tiene %q en orden: %q", n, bar)
		}
		last = i
	}
}

func TestBlockText(t *testing.T) {
	r := blockText("K7Q-4ZP")
	if len(r) != 5 || len([]rune(r[0])) != 7*6+6 {
		t.Errorf("código en bloque: %d líneas, %d columnas", len(r), len([]rune(r[0])))
	}
}

func TestMain(m *testing.M) {
	os.Setenv("LANTERN_NO_BROWSER", "1") // ninguna prueba abre el navegador real
	os.Exit(m.Run())
}

// La página de la clave se abre solo la primera vez por proveedor; «o» la reabre a petición.
func TestKeyPageOpensOnce(t *testing.T) {
	var opened []string
	openURL = func(u string) error { opened = append(opened, u); return nil }
	defer func() { openURL = platform.OpenURL }()
	a := New(Options{Paths: platform.Paths{Data: t.TempDir()}, Base: model.Config{Lang: "es"}, Lang: "es"})
	a.ai = aiFlow{}
	a.ai.prov.ID, a.ai.prov.KeyURL, a.ai.prov.NeedsKey, a.ai.params = "x", "https://ejemplo.test/clave", true, map[string]string{}
	for range 3 { // entrar, volver atrás y entrar otra vez
		newKeyScreen(a).Init(a)
	}
	if len(opened) != 1 {
		t.Fatalf("se abrió %d veces al entrar/salir, esperaba 1", len(opened))
	}
	s := newKeyScreen(a)
	s.Init(a)
	s.Update(a, tea.KeyPressMsg{Code: 'o', Text: "o"}) // campo vacío: «o» reabre
	if len(opened) != 2 {
		t.Fatalf("«o» debía reabrir la página: %d aperturas", len(opened))
	}
	a.ai.prov.ID, a.ai.prov.KeyURL = "y", "https://otro.test/clave" // otro proveedor: vuelve a abrir una vez
	newKeyScreen(a).Init(a)
	if len(opened) != 3 {
		t.Fatalf("otro proveedor: %d aperturas", len(opened))
	}
}
