// Package engine ejecuta la instalación local (modos local y lan) y las operaciones del panel.
package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"lantern/installer/ai"
	"lantern/installer/lantern"
	"lantern/installer/model"
	"lantern/installer/platform"
	"lantern/installer/tunnel"
)

const DefaultPort = 8787

// State es lo que se recuerda entre ejecuciones (sin secretos) en state.json.
type State struct {
	Lang    string `json:"lang"`
	Mode    string `json:"mode"`
	Tunnel  string `json:"tunnel"`
	Domain  string `json:"domain,omitempty"`
	Port    int    `json:"port"`
	Backend string `json:"backend"`
	Code    string `json:"code,omitempty"`
	Invite  string `json:"invite,omitempty"`
	Remote  string `json:"remote,omitempty"` // host SSH/URL si el servidor está fuera
}

func statePath(p platform.Paths) string { return filepath.Join(p.Data, "state.json") }

func LoadState(p platform.Paths) (State, bool) {
	var s State
	b, err := os.ReadFile(statePath(p))
	if err != nil || json.Unmarshal(b, &s) != nil {
		return s, false
	}
	return s, true
}

func SaveState(p platform.Paths, s State) error {
	b, _ := json.MarshalIndent(s, "", " ")
	return os.WriteFile(statePath(p), b, 0o600)
}

// Step es un paso visible de la instalación.
type Step struct{ ID, ES, EN string }

// Plan devuelve los pasos que ejecutará Run para esta configuración.
func Plan(c model.Config) []Step {
	s := []Step{{"files", "Preparando carpetas y configuración", "Preparing folders and configuration"},
		{"server", "Instalando el servidor de Lantern", "Installing the Lantern server"}}
	if c.Laya {
		s = append(s, Step{"laya", "Instalando Laya (IA local)", "Installing Laya (local AI)"})
	}
	if c.Mode == "local" && c.Tunnel != "none" {
		s = append(s, Step{"cloudflared", "Descargando cloudflared", "Downloading cloudflared"},
			Step{"tunnel", "Publicando tu enlace en Internet", "Publishing your link online"})
	}
	s = append(s, Step{"start", "Arrancando Lantern", "Starting Lantern"}, Step{"table", "Creando tu mesa", "Creating your table"})
	if c.ImportPath != "" {
		s = append(s, Step{"import", "Importando tu campaña", "Importing your campaign"})
	}
	return s
}

func paths(c model.Config) platform.Paths {
	if c.DataDir == "" {
		c.DataDir = platform.DefaultDataDir()
	}
	return platform.Paths{Data: c.DataDir}
}

func port(c model.Config) int {
	if c.Port == 0 {
		return DefaultPort
	}
	return c.Port
}

// ServerSvc y TunnelSvc describen los servicios del SO.
func ServerSvc(p platform.Paths) platform.Svc {
	return platform.Svc{Name: "lantern", Desc: "Lantern server", Exec: p.Server(), Dir: p.Data,
		Env: map[string]string{"LANTERN_CONFIG": p.Env()}, Log: p.Log("lantern"), Pid: p.Pid("lantern")}
}

func TunnelSvc(p platform.Paths, args []string) platform.Svc {
	return platform.Svc{Name: "lantern-tunnel", Desc: "Lantern tunnel (cloudflared)", Exec: p.Cloudflared(), Args: args, Dir: p.Data,
		Log: p.Log("lantern-tunnel"), Pid: p.Pid("lantern-tunnel")}
}

// TunnelArgs reconstruye los argumentos del túnel desde el estado.
func TunnelArgs(p platform.Paths, s State) []string {
	if s.Tunnel == "named" {
		return tunnel.NamedArgs(filepath.Join(p.Data, "cloudflared.yml"))
	}
	return tunnel.QuickArgs(s.Port)
}

// PortFree comprueba si un puerto TCP local está libre.
func PortFree(port int) bool {
	l, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		return false
	}
	l.Close()
	return true
}

// BuildEnv compone lantern.env a partir de la configuración, conservando lo existente (token y origen).
func BuildEnv(c model.Config, p platform.Paths, old map[string]string) map[string]string {
	e := map[string]string{}
	for k, v := range old {
		e[k] = v
	}
	// Fuera de la LAN se entra por un proxy local (cloudflared o Caddy): con TRUST_PROXY=1 los límites por IP usan
	// X-Forwarded-For en vez de ver a todos como 127.0.0.1. El servidor solo la acepta en conexiones desde loopback.
	host := "127.0.0.1"
	e["TRUST_PROXY"] = "1"
	if c.Mode == "lan" {
		host = "0.0.0.0"
		delete(e, "TRUST_PROXY")
	}
	e["PORT"], e["HOST"] = strconv.Itoa(port(c)), host
	e["LANTERN_DB"], e["LANTERN_ASSETS"], e["LANTERN_BACKUP_DIR"] = p.DB(), p.Assets(), p.Backups()
	if e["LANTERN_ADMIN_TOKEN"] == "" {
		e["LANTERN_ADMIN_TOKEN"] = lantern.RandomToken()
	}
	if c.Tunnel == "named" && c.Domain != "" {
		e["LANTERN_ORIGIN"] = "https://" + c.Domain
	}
	setLLM := func(prefix string, l *model.LLM) {
		for _, k := range []string{"FORMAT", "URL", "KEY", "MODEL", "HEADERS"} {
			delete(e, prefix+k)
		}
		if l == nil {
			return
		}
		e[prefix+"FORMAT"], e[prefix+"URL"], e[prefix+"KEY"], e[prefix+"MODEL"] = l.Format, l.URL, l.Key, l.Model
		if len(l.Headers) > 0 {
			b, _ := json.Marshal(l.Headers)
			e[prefix+"HEADERS"] = string(b)
		}
	}
	setLLM("LANTERN_LLM_", c.LLM)
	setLLM("LANTERN_LLM2_", c.LLM2)
	if c.Laya {
		e["LANTERN_LAYA"] = "1"
		e["LANTERN_LAYA_DEVICE"] = "cpu"
	}
	return e
}

// Run ejecuta la instalación local. progress(i, msg): i indexa Plan(c); msg es una línea de detalle (puede ser "").
func Run(ctx context.Context, c model.Config, progress func(step int, msg string)) (model.Result, error) {
	p := paths(c)
	plan := Plan(c)
	idx := map[string]int{}
	for i, s := range plan {
		idx[s.ID] = i
	}
	at := func(id string) func(string) { return func(m string) { progress(idx[id], m) } }
	fail := func(id string, err error) (model.Result, error) {
		return model.Result{}, fmt.Errorf("%s: %w", plan[idx[id]].ES, err)
	}
	mgr := platform.Manager{Kind: platform.Backend(c.NoService), P: p}

	at("files")("")
	for _, d := range []string{p.Data, p.Bin(), p.Logs(), p.Assets(), p.Backups()} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return fail("files", err)
		}
	}
	old := lantern.ReadEnv(p.Env())
	env := BuildEnv(c, p, old)
	if !PortFree(port(c)) && old["PORT"] != strconv.Itoa(port(c)) {
		return fail("files", fmt.Errorf("el puerto %d está ocupado; elige otro", port(c)))
	}
	if err := lantern.WriteEnv(p.Env(), env); err != nil {
		return fail("files", err)
	}

	srv := ServerSvc(p)
	// Si había una instalación anterior, se para antes de sustituir el binario.
	_ = mgr.Stop(srv)
	at("server")("")
	if err := lantern.InstallServer(ctx, c.ServerBin, c.Releases, c.Version, p.Server()); err != nil {
		return fail("server", err)
	}

	if c.Laya {
		py, err := ai.InstallLaya(ctx, p.Data, at("laya"))
		if err != nil {
			return fail("laya", err)
		}
		env["LANTERN_LAYA_PYTHON"] = py
		if err := lantern.WriteEnv(p.Env(), env); err != nil {
			return fail("laya", err)
		}
	}

	st := State{Lang: c.Lang, Mode: c.Mode, Tunnel: c.Tunnel, Domain: c.Domain, Port: port(c), Backend: mgr.Kind}
	if c.Mode != "local" {
		st.Tunnel = "none"
	}
	if c.Mode == "local" && c.Tunnel != "none" {
		at("cloudflared")("")
		if err := tunnel.Download(ctx, goos, goarch, p.Cloudflared()); err != nil {
			return fail("cloudflared", err)
		}
		tlog := at("tunnel")
		var args []string
		if c.Tunnel == "named" {
			cfg, err := tunnel.SetupNamed(ctx, p.Cloudflared(), p.Data, c.Domain, port(c), tlog)
			if err != nil {
				return fail("tunnel", err)
			}
			args = tunnel.NamedArgs(cfg)
		} else {
			args = tunnel.QuickArgs(port(c))
		}
		ts := TunnelSvc(p, args)
		_ = os.Remove(ts.Log)
		if err := mgr.Install(ts, c.Linger); err != nil {
			return fail("tunnel", err)
		}
		if err := mgr.Start(ts); err != nil {
			return fail("tunnel", err)
		}
		if c.Tunnel == "quick" {
			tlog("Esperando el enlace de Cloudflare…")
			u, err := tunnel.WaitQuickURL(ctx, ts.Log, 60*time.Second)
			if err != nil {
				return fail("tunnel", err)
			}
			env["LANTERN_ORIGIN"] = u
			if err := lantern.WriteEnv(p.Env(), env); err != nil {
				return fail("tunnel", err)
			}
		}
	}

	at("start")("")
	if err := mgr.Install(srv, c.Linger); err != nil {
		return fail("start", err)
	}
	if err := mgr.Start(srv); err != nil {
		return fail("start", err)
	}
	base := "http://127.0.0.1:" + strconv.Itoa(port(c))
	if err := lantern.WaitHealth(ctx, base, 45*time.Second); err != nil {
		return fail("start", fmt.Errorf("%w; mira %s", err, srv.Log))
	}

	at("table")("")
	adm := &lantern.Admin{Base: base, Token: env["LANTERN_ADMIN_TOKEN"]}
	t, err := adm.Bootstrap(ctx, c.DMName, c.Title)
	if err != nil {
		return fail("table", err)
	}
	if c.ImportPath != "" {
		sum, err := adm.Import(ctx, t.Code, c.ImportPath)
		if err != nil {
			return fail("import", err)
		}
		at("import")(sum)
	}
	st.Code, st.Invite = t.Code, t.InviteURL
	if err := SaveState(p, st); err != nil {
		return fail("table", err)
	}
	return model.Result{Code: t.Code, InviteURL: t.InviteURL, DMURL: t.DMURL, Origin: env["LANTERN_ORIGIN"]}, nil
}

// Admin devuelve el cliente admin de una instalación existente.
func Admin(p platform.Paths, s State) *lantern.Admin {
	return &lantern.Admin{Base: "http://127.0.0.1:" + strconv.Itoa(s.Port), Token: lantern.ReadEnv(p.Env())["LANTERN_ADMIN_TOKEN"]}
}

// SyncOrigin relee la URL del enlace rápido del registro del túnel y, si cambió, actualiza lantern.env y reinicia el servidor.
func SyncOrigin(p platform.Paths, s State) (changed bool, err error) {
	if s.Tunnel != "quick" {
		return false, nil
	}
	b, err := os.ReadFile(p.Log("lantern-tunnel"))
	if err != nil {
		return false, err
	}
	u := tunnel.ExtractQuickURL(string(b))
	env := lantern.ReadEnv(p.Env())
	if u == "" || env["LANTERN_ORIGIN"] == u {
		return false, nil
	}
	env["LANTERN_ORIGIN"] = u
	if err := lantern.WriteEnv(p.Env(), env); err != nil {
		return false, err
	}
	m := platform.Manager{Kind: s.Backend, P: p}
	return true, m.Start(ServerSvc(p))
}

// Services devuelve estado en vivo.
func Services(p platform.Paths, s State) (server, tun bool) {
	m := platform.Manager{Kind: s.Backend, P: p}
	server = m.Running(ServerSvc(p))
	if s.Tunnel != "none" && s.Tunnel != "" {
		tun = m.Running(TunnelSvc(p, TunnelArgs(p, s)))
	}
	return
}

// Restart reinicia servidor (y túnel si existe).
func Restart(p platform.Paths, s State) error {
	m := platform.Manager{Kind: s.Backend, P: p}
	return m.Start(ServerSvc(p))
}

// Update descarga la última versión (o la de local), sustituye el binario y reinicia.
func Update(ctx context.Context, p platform.Paths, s State, localBin, releases string) error {
	m := platform.Manager{Kind: s.Backend, P: p}
	srv := ServerSvc(p)
	_ = m.Stop(srv)
	if err := lantern.InstallServer(ctx, localBin, releases, "", p.Server()); err != nil {
		_ = m.Start(srv)
		return err
	}
	return m.Start(srv)
}

// Uninstall quita servicios y binarios. Con purge también borra datos (DB, assets, backups, env).
func Uninstall(p platform.Paths, s State, purge bool) error {
	m := platform.Manager{Kind: s.Backend, P: p}
	m.Uninstall(ServerSvc(p))
	m.Uninstall(TunnelSvc(p, nil))
	if purge {
		return os.RemoveAll(p.Data)
	}
	var errs []error
	for _, d := range []string{p.Bin(), filepath.Join(p.Data, "run"), filepath.Join(p.Data, "python"), filepath.Join(p.Data, "uv-cache"), filepath.Join(p.Data, "laya-venv")} {
		errs = append(errs, os.RemoveAll(d))
	}
	os.Remove(statePath(p))
	return errors.Join(errs...)
}
