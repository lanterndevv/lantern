package tunnel

import (
	"strings"
	"testing"
)

const sample = `2026-09-29T17:04:12Z INF Thank you for trying Cloudflare Tunnel. Doing so, without a Cloudflare account, is a quick way to experiment and try it out.
2026-09-29T17:04:12Z INF Requesting new quick Tunnel on trycloudflare.com...
2026-09-29T17:04:15Z INF +--------------------------------------------------------------------------------------------+
2026-09-29T17:04:15Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
2026-09-29T17:04:15Z INF |  https://smtp-suppose-loved-male.trycloudflare.com                                         |
2026-09-29T17:04:15Z INF +--------------------------------------------------------------------------------------------+
2026-09-29T17:04:15Z INF Registered tunnel connection connIndex=0 location=mad01 protocol=quic
`

func TestExtractQuickURL(t *testing.T) {
	if got := ExtractQuickURL(sample); got != "https://smtp-suppose-loved-male.trycloudflare.com" {
		t.Errorf("url = %q", got)
	}
	if ExtractQuickURL("nada aquí, api.trycloudflare.com sin https") != "" {
		t.Error("sin URL debe devolver vacío")
	}
	// tras un reinicio el registro acumula dos enlaces: vale el último
	if got := ExtractQuickURL(sample + "\nhttps://otra-cosa-nueva.trycloudflare.com\n"); got != "https://otra-cosa-nueva.trycloudflare.com" {
		t.Errorf("último = %q", got)
	}
}

func TestAssetAndConfig(t *testing.T) {
	for _, c := range [][3]string{{"linux", "amd64", "cloudflared-linux-amd64"}, {"darwin", "arm64", "cloudflared-darwin-arm64.tgz"}, {"windows", "amd64", "cloudflared-windows-amd64.exe"}} {
		if a, err := Asset(c[0], c[1]); err != nil || a != c[2] {
			t.Errorf("%v -> %q %v", c, a, err)
		}
	}
	if _, err := Asset("linux", "386"); err == nil {
		t.Error("386 no soportada")
	}
	id := ExtractTunnelID("Created tunnel lantern with id 6ff42ae2-765d-4adf-8112-31c55c1551ef")
	cfg := Config(id, "/h/.cloudflared/"+id+".json", "mesa.ejemplo.com", 8787)
	for _, w := range []string{"tunnel: " + id, "hostname: mesa.ejemplo.com", "service: http://localhost:8787", "http_status:404"} {
		if !strings.Contains(cfg, w) {
			t.Errorf("falta %q en\n%s", w, cfg)
		}
	}
}
