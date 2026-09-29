package platform

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"text/template"
	"time"
)

// Svc describe un proceso de larga vida (servidor o túnel).
type Svc struct {
	Name string // "lantern" | "lantern-tunnel"
	Desc string
	Exec string
	Args []string
	Dir  string
	Env  map[string]string
	Log  string
	Pid  string // solo backend "process"
}

// Backend elige cómo se gestiona: systemd, launchd, schtasks o process (desacoplado, sin autoarranque).
func Backend(noService bool) string {
	if noService {
		return "process"
	}
	switch runtime.GOOS {
	case "darwin":
		return "launchd"
	case "windows":
		return "schtasks"
	}
	if _, err := exec.LookPath("systemctl"); err == nil {
		if exec.Command("systemctl", "--user", "show-environment").Run() == nil {
			return "systemd"
		}
	}
	return "process"
}

func q(s string) string { return `"` + strings.ReplaceAll(s, `"`, `\"`) + `"` }

var unitTpl = template.Must(template.New("u").Funcs(template.FuncMap{"q": q}).Parse(`[Unit]
Description={{.Desc}}
After=network-online.target

[Service]
ExecStart={{q .Exec}}{{range .Args}} {{q .}}{{end}}
{{- if .Dir}}
WorkingDirectory={{.Dir}}
{{- end}}
{{- range $k, $v := .Env}}
Environment={{q (printf "%s=%s" $k $v)}}
{{- end}}
Restart=on-failure
RestartSec=3
StandardOutput=append:{{.Log}}
StandardError=append:{{.Log}}

[Install]
WantedBy=default.target
`))

var plistTpl = template.Must(template.New("p").Parse(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>es.lantern.{{.Name}}</string>
<key>ProgramArguments</key><array>
<string>{{.Exec}}</string>{{range .Args}}
<string>{{.}}</string>{{end}}
</array>
{{- if .Dir}}
<key>WorkingDirectory</key><string>{{.Dir}}</string>{{end}}
{{- if .Env}}
<key>EnvironmentVariables</key><dict>{{range $k, $v := .Env}}
<key>{{$k}}</key><string>{{$v}}</string>{{end}}
</dict>{{end}}
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>StandardOutPath</key><string>{{.Log}}</string>
<key>StandardErrorPath</key><string>{{.Log}}</string>
</dict></plist>
`))

// Windows: un .vbs lanza el proceso oculto con su registro; schtasks lo ejecuta al iniciar sesión.
func vbs(s Svc) string {
	lit := func(x string) string { return `"` + strings.ReplaceAll(x, `"`, `""`) + `"` }
	cmd := `"` + s.Exec + `"`
	for _, a := range s.Args {
		cmd += ` "` + a + `"`
	}
	cmd = `cmd /c "` + cmd + ` >> "` + s.Log + `" 2>&1"`
	out := "Set sh = CreateObject(\"WScript.Shell\")\r\n"
	for k, v := range s.Env {
		out += "sh.Environment(\"Process\")(" + lit(k) + ") = " + lit(v) + "\r\n"
	}
	if s.Dir != "" {
		out += "sh.CurrentDirectory = " + lit(s.Dir) + "\r\n"
	}
	return out + "sh.Run " + lit(cmd) + ", 0, False\r\n"
}

// Render devuelve el contenido de los archivos de servicio para un SO (función pura, para tests).
// Claves: nombre relativo del archivo.
func Render(goos string, s Svc) (map[string]string, error) {
	var b bytes.Buffer
	switch goos {
	case "linux":
		if err := unitTpl.Execute(&b, s); err != nil {
			return nil, err
		}
		return map[string]string{s.Name + ".service": b.String()}, nil
	case "darwin":
		if err := plistTpl.Execute(&b, s); err != nil {
			return nil, err
		}
		return map[string]string{"es.lantern." + s.Name + ".plist": b.String()}, nil
	case "windows":
		return map[string]string{s.Name + ".vbs": vbs(s)}, nil
	}
	return nil, fmt.Errorf("SO no soportado: %s", goos)
}

// Manager instala y controla servicios con un backend concreto.
type Manager struct {
	Kind string
	P    Paths
}

func run(name string, args ...string) (string, error) {
	out, err := exec.Command(name, args...).CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

func home() string { h, _ := os.UserHomeDir(); return h }

// Install registra el servicio (no lo arranca). linger: solo Linux/systemd.
func (m Manager) Install(s Svc, linger bool) error {
	if err := os.MkdirAll(filepath.Dir(s.Log), 0o755); err != nil {
		return err
	}
	if m.Kind == "process" {
		return nil
	}
	files, err := Render(runtime.GOOS, s)
	if err != nil {
		return err
	}
	switch m.Kind {
	case "systemd":
		dir := filepath.Join(home(), ".config", "systemd", "user")
		_ = os.MkdirAll(dir, 0o755)
		if err := os.WriteFile(filepath.Join(dir, s.Name+".service"), []byte(files[s.Name+".service"]), 0o644); err != nil {
			return err
		}
		if o, err := run("systemctl", "--user", "daemon-reload"); err != nil {
			return fmt.Errorf("systemctl: %s", o)
		}
		if o, err := run("systemctl", "--user", "enable", s.Name+".service"); err != nil {
			return fmt.Errorf("systemctl enable: %s", o)
		}
		if linger {
			if u := os.Getenv("USER"); u != "" {
				_, _ = run("loginctl", "enable-linger", u)
			}
		}
	case "launchd":
		dir := filepath.Join(home(), "Library", "LaunchAgents")
		_ = os.MkdirAll(dir, 0o755)
		return os.WriteFile(filepath.Join(dir, "es.lantern."+s.Name+".plist"), []byte(files["es.lantern."+s.Name+".plist"]), 0o644)
	case "schtasks":
		f := filepath.Join(m.P.Bin(), s.Name+".vbs")
		if err := os.WriteFile(f, []byte(files[s.Name+".vbs"]), 0o644); err != nil {
			return err
		}
		if o, err := run("schtasks", "/Create", "/TN", s.Name, "/TR", `wscript.exe //B "`+f+`"`, "/SC", "ONLOGON", "/F"); err != nil {
			return fmt.Errorf("schtasks: %s", o)
		}
	}
	return nil
}

func (m Manager) Start(s Svc) error {
	switch m.Kind {
	case "systemd":
		o, err := run("systemctl", "--user", "restart", s.Name+".service")
		if err != nil {
			return fmt.Errorf("systemctl restart: %s", o)
		}
	case "launchd":
		p := filepath.Join(home(), "Library", "LaunchAgents", "es.lantern."+s.Name+".plist")
		_, _ = run("launchctl", "unload", p)
		if o, err := run("launchctl", "load", "-w", p); err != nil {
			return fmt.Errorf("launchctl: %s", o)
		}
	case "schtasks":
		if o, err := run("schtasks", "/Run", "/TN", s.Name); err != nil {
			return fmt.Errorf("schtasks: %s", o)
		}
	default:
		return m.spawn(s)
	}
	return nil
}

func (m Manager) Stop(s Svc) error {
	switch m.Kind {
	case "systemd":
		_, err := run("systemctl", "--user", "stop", s.Name+".service")
		return err
	case "launchd":
		_, err := run("launchctl", "unload", filepath.Join(home(), "Library", "LaunchAgents", "es.lantern."+s.Name+".plist"))
		return err
	case "schtasks":
		_, _ = run("schtasks", "/End", "/TN", s.Name)
		_, _ = run("taskkill", "/F", "/T", "/IM", filepath.Base(s.Exec))
		return nil
	}
	pid := readPid(s.Pid)
	if pid <= 0 {
		return nil
	}
	proc, _ := os.FindProcess(pid)
	_ = proc.Signal(syscall.SIGTERM)
	for i := 0; i < 50 && alive(pid); i++ {
		time.Sleep(100 * time.Millisecond)
	}
	if alive(pid) {
		_ = proc.Kill()
	}
	os.Remove(s.Pid)
	return nil
}

func (m Manager) Running(s Svc) bool {
	switch m.Kind {
	case "systemd":
		return exec.Command("systemctl", "--user", "is-active", "--quiet", s.Name+".service").Run() == nil
	case "launchd":
		return exec.Command("launchctl", "list", "es.lantern."+s.Name).Run() == nil
	case "schtasks":
		o, _ := run("tasklist", "/FI", "IMAGENAME eq "+filepath.Base(s.Exec))
		return strings.Contains(strings.ToLower(o), strings.ToLower(filepath.Base(s.Exec)))
	}
	return alive(readPid(s.Pid))
}

func (m Manager) Uninstall(s Svc) {
	_ = m.Stop(s)
	switch m.Kind {
	case "systemd":
		_, _ = run("systemctl", "--user", "disable", s.Name+".service")
		os.Remove(filepath.Join(home(), ".config", "systemd", "user", s.Name+".service"))
		_, _ = run("systemctl", "--user", "daemon-reload")
	case "launchd":
		os.Remove(filepath.Join(home(), "Library", "LaunchAgents", "es.lantern."+s.Name+".plist"))
	case "schtasks":
		_, _ = run("schtasks", "/Delete", "/TN", s.Name, "/F")
	}
}

func readPid(f string) int {
	b, err := os.ReadFile(f)
	if err != nil {
		return 0
	}
	n, _ := strconv.Atoi(strings.TrimSpace(string(b)))
	return n
}
