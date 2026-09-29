package lantern

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestWriteEnvPerms(t *testing.T) {
	p := filepath.Join(t.TempDir(), "sub", "lantern.env")
	if err := WriteEnv(p, map[string]string{"PORT": "8787", "LANTERN_LLM_KEY": "sk-secret", "VACIO": ""}); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if st, _ := os.Stat(p); st.Mode().Perm() != 0o600 {
			t.Errorf("permisos %v, quiero 600", st.Mode().Perm())
		}
	}
	m := ReadEnv(p)
	if m["PORT"] != "8787" || m["LANTERN_LLM_KEY"] != "sk-secret" {
		t.Errorf("relectura: %v", m)
	}
	if _, ok := m["VACIO"]; ok {
		t.Error("las claves vacías no se escriben")
	}
	if a, b := RandomToken(), RandomToken(); len(a) != 64 || a == b {
		t.Error("token aleatorio inválido")
	}
}

func TestAssetName(t *testing.T) {
	for _, c := range [][3]string{{"linux", "amd64", "lantern-server-linux-x64"}, {"darwin", "arm64", "lantern-server-macos-arm64"}, {"windows", "amd64", "lantern-server-windows-x64.exe"}} {
		if got, err := AssetName(c[0], c[1]); err != nil || got != c[2] {
			t.Errorf("%v -> %q %v", c, got, err)
		}
	}
	if _, err := AssetName("linux", "riscv64"); err == nil {
		t.Error("arch no soportada debe fallar")
	}
}

func TestInstallServerChecksum(t *testing.T) {
	body := []byte("binario-falso")
	sum := sha256.Sum256(body)
	name, _ := AssetName(runtime.GOOS, runtime.GOARCH)
	good := hex.EncodeToString(sum[:])
	mux := func(hash string) http.Handler {
		m := http.NewServeMux()
		m.HandleFunc("/v1/SHA256SUMS", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(hash + "  " + name + "\n")) })
		m.HandleFunc("/v1/"+name, func(w http.ResponseWriter, r *http.Request) { w.Write(body) })
		return m
	}
	srv := httptest.NewServer(mux(good))
	defer srv.Close()
	dest := filepath.Join(t.TempDir(), "bin", "lantern-server")
	if err := InstallServer(context.Background(), "", srv.URL, "v1", dest); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(dest); string(b) != string(body) {
		t.Error("contenido distinto")
	}
	bad := httptest.NewServer(mux(strings.Repeat("0", 64)))
	defer bad.Close()
	dest2 := filepath.Join(t.TempDir(), "x")
	if err := InstallServer(context.Background(), "", bad.URL, "v1", dest2); err == nil {
		t.Fatal("un SHA256 incorrecto debe rechazarse")
	}
	if _, err := os.Stat(dest2); err == nil {
		t.Error("no debe quedar el binario descartado")
	}
}

func TestInstallServerLocalCopy(t *testing.T) {
	src := filepath.Join(t.TempDir(), "src")
	os.WriteFile(src, []byte("x"), 0o644)
	dest := filepath.Join(t.TempDir(), "d", "srv")
	if err := InstallServer(context.Background(), src, "", "", dest); err != nil {
		t.Fatal(err)
	}
	if st, _ := os.Stat(dest); runtime.GOOS != "windows" && st.Mode().Perm()&0o100 == 0 {
		t.Error("debe ser ejecutable")
	}
}

func TestAdminClient(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("authorization") != "Bearer tok" {
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case "/admin/status":
			w.Write([]byte(`{"version":"1.0.0","rooms":2,"llm":true,"laya":"ready","origin":"https://x"}`))
		case "/admin/bootstrap":
			w.Write([]byte(`{"code":"ABC123","inviteUrl":"https://x/?code=ABC123","dmUrl":"https://x/?code=ABC123#k=z"}`))
		case "/admin/import":
			if r.URL.Query().Get("kind") != "uvtt" || r.URL.Query().Get("code") != "ABC123" {
				w.WriteHeader(400)
				return
			}
			w.Write([]byte(`{"ok":true,"summary":{"walls":3}}`))
		}
	}))
	defer srv.Close()
	a := &Admin{Base: srv.URL, Token: "tok"}
	ctx := context.Background()
	if s, err := a.Status(ctx); err != nil || s.Rooms != 2 || s.Laya != "ready" {
		t.Errorf("status %+v %v", s, err)
	}
	tb, err := a.Bootstrap(ctx, "DM", "Mesa")
	if err != nil || tb.Code != "ABC123" || !strings.Contains(tb.DMURL, "#k=") {
		t.Errorf("bootstrap %+v %v", tb, err)
	}
	f := filepath.Join(t.TempDir(), "m.dd2vtt")
	os.WriteFile(f, []byte("{}"), 0o644)
	if s, err := a.Import(ctx, "ABC123", f); err != nil || !strings.Contains(s, "walls") {
		t.Errorf("import %q %v", s, err)
	}
	if _, err := (&Admin{Base: srv.URL, Token: "mal"}).Status(ctx); err == nil {
		t.Error("token incorrecto debe fallar")
	}
}
