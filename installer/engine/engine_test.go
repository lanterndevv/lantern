package engine

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"testing"
	"time"

	"lantern/installer/lantern"
	"lantern/installer/model"
	"lantern/installer/platform"
)

func TestBuildEnv(t *testing.T) {
	p := platform.Paths{Data: "/d"}
	c := model.Config{Mode: "local", Tunnel: "named", Domain: "mesa.x.com", Port: 9000,
		LLM:  &model.LLM{Format: "gemini", URL: "https://g", Key: "K", Model: "m"},
		LLM2: &model.LLM{Format: "openai", URL: "https://o", Key: "K2", Model: "m2", Headers: map[string]string{"x-a": "b"}}, Laya: true}
	e := BuildEnv(c, p, map[string]string{"LANTERN_ADMIN_TOKEN": "keep"})
	want := map[string]string{"PORT": "9000", "HOST": "127.0.0.1", "TRUST_PROXY": "1", "LANTERN_ORIGIN": "https://mesa.x.com", "LANTERN_ADMIN_TOKEN": "keep",
		"LANTERN_LLM_FORMAT": "gemini", "LANTERN_LLM_KEY": "K", "LANTERN_LLM2_MODEL": "m2", "LANTERN_LLM2_HEADERS": `{"x-a":"b"}`, "LANTERN_LAYA": "1"}
	for k, v := range want {
		if e[k] != v {
			t.Errorf("%s = %q, quiero %q", k, e[k], v)
		}
	}
	c.Mode = "lan"
	c.LLM, c.LLM2 = nil, nil
	if e2 := BuildEnv(c, p, e); e2["HOST"] != "0.0.0.0" || e2["TRUST_PROXY"] != "" || e2["LANTERN_LLM_KEY"] != "" {
		t.Errorf("lan/quitar IA: %v", e2)
	}
}

func TestPlan(t *testing.T) {
	ids := func(c model.Config) (r []string) {
		for _, s := range Plan(c) {
			r = append(r, s.ID)
		}
		return
	}
	if got := ids(model.Config{Mode: "local", Tunnel: "quick", Laya: true, ImportPath: "x"}); len(got) != 8 {
		t.Errorf("plan local completo: %v", got)
	}
	if got := ids(model.Config{Mode: "lan", Tunnel: "none"}); len(got) != 4 {
		t.Errorf("plan lan: %v", got)
	}
}

// E2E real con el binario SEA (se omite si no existe): instalar, mesa, actualizar y desinstalar.
func TestRunUpdateUninstall(t *testing.T) {
	bin, _ := filepath.Abs("../../dist-bin/lantern-server-linux-x64")
	if _, err := os.Stat(bin); err != nil || runtime.GOOS != "linux" || runtime.GOARCH != "amd64" {
		t.Skip("no hay binario SEA de servidor")
	}
	l, _ := net.Listen("tcp", "127.0.0.1:0")
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()
	dir := t.TempDir()
	c := model.Config{Mode: "local", Tunnel: "none", DataDir: dir, Port: port, ServerBin: bin, NoService: true, DMName: "T", Title: "Mesa"}
	res, err := Run(context.Background(), c, func(int, string) {})
	if err != nil {
		t.Fatal(err)
	}
	p := platform.Paths{Data: dir}
	st, ok := LoadState(p)
	if !ok || st.Code != res.Code || res.Code == "" {
		t.Fatalf("estado %+v res %+v", st, res)
	}
	defer Uninstall(p, st, true)
	if srv, _ := Services(p, st); !srv {
		t.Fatal("el servidor debería estar en marcha")
	}
	s, err := Admin(p, st).Status(context.Background())
	if err != nil || s.Rooms < 1 {
		t.Errorf("status %+v %v", s, err)
	}
	if err := Update(context.Background(), p, st, bin, ""); err != nil {
		t.Fatal(err)
	}
	if err := lantern.WaitHealth(context.Background(), "http://127.0.0.1:"+strconv.Itoa(port), 30*time.Second); err != nil {
		t.Fatal(err)
	}
	if err := Uninstall(p, st, false); err != nil {
		t.Fatal(err)
	}
	if srv, _ := Services(p, st); srv {
		t.Error("tras desinstalar no debe quedar el servidor")
	}
	if _, err := os.Stat(p.DB()); err != nil {
		t.Error("desinstalar sin purge debe conservar los datos")
	}
	if _, err := os.Stat(p.Server()); err == nil {
		t.Error("el binario debería haberse quitado")
	}
}
