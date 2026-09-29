package platform

import (
	"strings"
	"testing"
)

var svc = Svc{Name: "lantern", Desc: "Lantern server", Exec: "/data/bin/lantern-server", Dir: "/data",
	Env: map[string]string{"LANTERN_CONFIG": "/data/lantern.env"}, Log: "/data/logs/lantern.log"}

func TestRender(t *testing.T) {
	cases := map[string][]string{
		"linux":   {"ExecStart=\"/data/bin/lantern-server\"", "Environment=\"LANTERN_CONFIG=/data/lantern.env\"", "append:/data/logs/lantern.log", "WantedBy=default.target", "Restart=on-failure"},
		"darwin":  {"<string>/data/bin/lantern-server</string>", "<key>LANTERN_CONFIG</key><string>/data/lantern.env</string>", "RunAtLoad", "es.lantern.lantern"},
		"windows": {`sh.Run `, `lantern-server`, `>> `, `LANTERN_CONFIG`, `, 0, False`},
	}
	for goos, want := range cases {
		files, err := Render(goos, svc)
		if err != nil || len(files) != 1 {
			t.Fatalf("%s: %v %v", goos, files, err)
		}
		for name, body := range files {
			for _, w := range want {
				if !strings.Contains(body, w) {
					t.Errorf("%s/%s: falta %q en\n%s", goos, name, w, body)
				}
			}
		}
	}
	if _, err := Render("plan9", svc); err == nil {
		t.Error("SO desconocido debe fallar")
	}
}

func TestWindowsVBSQuoting(t *testing.T) {
	f, _ := Render("windows", Svc{Name: "x", Exec: `C:\A B\x.exe`, Args: []string{"tunnel"}, Log: `C:\l.log`})
	b := f["x.vbs"]
	// las comillas dobles del comando van duplicadas dentro del literal de VBScript
	if !strings.Contains(b, `""C:\A B\x.exe"" ""tunnel""`) {
		t.Errorf("comillas VBS incorrectas:\n%s", b)
	}
}

func TestBackendNoService(t *testing.T) {
	if Backend(true) != "process" {
		t.Error("--no-service debe usar el backend process")
	}
}
