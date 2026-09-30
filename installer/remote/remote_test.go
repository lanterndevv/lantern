package remote

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func TestKeys(t *testing.T) {
	d := t.TempDir()
	p, pub, err := EnsureKey(d)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(pub, "ssh-ed25519 ") || strings.Contains(pub, "\n") {
		t.Fatalf("formato: %q", pub)
	}
	if _, _, _, _, err := ssh.ParseAuthorizedKey([]byte(pub)); err != nil {
		t.Fatal(err)
	}
	if st, _ := os.Stat(p); st.Mode().Perm() != 0o600 {
		t.Fatal("permisos")
	}
	if _, pub2, _ := EnsureKey(d); pub2 != pub {
		t.Fatal("no reutiliza la clave")
	}
}

func TestCaddyfile(t *testing.T) {
	c := Caddyfile("1-2-3-4.sslip.io", 8787, true)
	for _, w := range []string{"1-2-3-4.sslip.io {", "reverse_proxy 127.0.0.1:8787", "handle_path /livekit/*", "127.0.0.1:7880"} {
		if !strings.Contains(c, w) {
			t.Errorf("falta %q en\n%s", w, c)
		}
	}
	if strings.Contains(Caddyfile("a.b", 1, false), "livekit") {
		t.Error("livekit sin pedirlo")
	}
	if SSLIPDomain("1.2.3.4") != "1-2-3-4.sslip.io" {
		t.Error("sslip")
	}
}

func TestScriptSyntax(t *testing.T) {
	f := filepath.Join(t.TempDir(), "i.sh")
	os.WriteFile(f, []byte(InstallScript), 0o600)
	if out, err := exec.Command("bash", "-n", f).CombinedOutput(); err != nil {
		t.Fatalf("bash -n: %s", out)
	}
	if sc, err := exec.LookPath("shellcheck"); err == nil {
		if out, err := exec.Command(sc, "-S", "warning", f).CombinedOutput(); err != nil {
			t.Fatalf("shellcheck: %s", out)
		}
	}
}

// El lantern.env y sus temporales nacen 600 aunque la umask heredada sea 022 (actualización), y la umask no se filtra al resto del script.
func TestEnvPermisos(t *testing.T) {
	var lines []string
	for _, l := range strings.Split(InstallScript, "\n") {
		if strings.HasPrefix(l, "[ -f \"$ENV\" ]") || strings.HasPrefix(l, "setenv() ") {
			lines = append(lines, l)
		}
	}
	if len(lines) != 2 {
		t.Fatalf("no encuentro la creación de $ENV y setenv: %q", lines)
	}
	env := filepath.Join(t.TempDir(), "lantern.env")
	script := "umask 022; ENV=" + env + "\n" + strings.Join(lines, "\n") + "\nsetenv A 1; setenv A 2; umask\n"
	for i := 0; i < 2; i++ { // instalación nueva y actualización (el archivo ya existe)
		out, err := exec.Command("bash", "-ec", script).CombinedOutput()
		if err != nil {
			t.Fatalf("bash: %v %s", err, out)
		}
		if strings.TrimSpace(string(out)) != "0022" {
			t.Errorf("la umask se filtra al resto del script: %s", out)
		}
		st, _ := os.Stat(env)
		if st.Mode().Perm() != 0o600 {
			t.Errorf("pasada %d: permisos %v", i, st.Mode().Perm())
		}
	}
}

// servidor SSH de prueba: guarda lo subido con cat y captura el comando de instalación.
type fakeSSH struct {
	addr  string
	mu    sync.Mutex
	files map[string]string
	cmd   string
	fp    string
}

func startFake(t *testing.T, hostSigner ssh.Signer, failFirst int) *fakeSSH {
	f := &fakeSSH{files: map[string]string{}}
	cfg := &ssh.ServerConfig{PublicKeyCallback: func(ssh.ConnMetadata, ssh.PublicKey) (*ssh.Permissions, error) { return nil, nil }}
	cfg.AddHostKey(hostSigner)
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { l.Close() })
	f.addr = l.Addr().String()
	go func() {
		n := 0
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			if n++; n <= failFirst { // simula la VM arrancando
				c.Close()
				continue
			}
			go f.serve(c, cfg)
		}
	}()
	return f
}

func (f *fakeSSH) serve(c net.Conn, cfg *ssh.ServerConfig) {
	_, chans, reqs, err := ssh.NewServerConn(c, cfg)
	if err != nil {
		return
	}
	go ssh.DiscardRequests(reqs)
	for nc := range chans {
		ch, rq, _ := nc.Accept()
		go func() {
			for r := range rq {
				if r.Type != "exec" {
					r.Reply(false, nil)
					continue
				}
				cmd := string(r.Payload[4:])
				r.Reply(true, nil)
				in, _ := io.ReadAll(ch) // hasta EOF: sólo ocurre en los cat; en el install no hay stdin
				_ = in
				f.mu.Lock()
				if i := strings.Index(cmd, "cat > "); i >= 0 {
					f.files[strings.Fields(cmd[i+6:])[0]] = string(in)
				} else {
					f.cmd = cmd
					io.WriteString(ch, "[lantern] listo\nLANTERN_BOOTSTRAP {\"code\":\"ABC123\",\"inviteUrl\":\"https://x/i\",\"dmUrl\":\"https://x/dm#k=1\"}\n")
				}
				f.mu.Unlock()
				ch.SendRequest("exit-status", false, []byte{0, 0, 0, 0})
				ch.Close()
			}
		}()
	}
}

func TestDeployAgainstFakeSSH(t *testing.T) {
	_, hk, _ := ed25519.GenerateKey(rand.Reader)
	hs, _ := ssh.NewSignerFromKey(hk)
	f := startFake(t, hs, 2)
	dir := t.TempDir()
	key, _, _ := EnsureKey(dir)
	host, port, _ := net.SplitHostPort(f.addr)
	var pn int
	for _, ch := range port {
		pn = pn*10 + int(ch-'0')
	}
	var logs []string
	cfg := Config{Host: host, Port: pn, KeyPath: key, KnownHostsPath: filepath.Join(dir, "known"), ReleasesURL: "https://r", Version: "v1.0.0",
		LiveKit: true, DMName: "O'Neil", ExtraEnv: map[string]string{"LANTERN_LLM_KEY": "k"}, RetryEvery: 10 * time.Millisecond, ConnectTimeout: 5 * time.Second}
	res, err := Deploy(context.Background(), cfg, func(s string) { logs = append(logs, s) })
	if err != nil {
		t.Fatal(err)
	}
	if res.Code != "ABC123" || !strings.Contains(res.DMURL, "#k=") || res.Domain != "127-0-0-1.sslip.io" {
		t.Fatalf("res %+v", res)
	}
	all := strings.Join(logs, "\n")
	if !strings.Contains(all, "primera conexión") || !strings.Contains(all, "esperando a que la VM") || !strings.Contains(all, "listo") {
		t.Fatalf("logs:\n%s", all)
	}
	if strings.Contains(all, "#k=") {
		t.Fatal("la clave del DM no debe ir al log")
	}
	if f.files["/tmp/lantern-install.sh"] != InstallScript {
		t.Fatal("script no subido íntegro")
	}
	if !strings.Contains(f.files["/tmp/lantern-Caddyfile"], "/livekit/") || !strings.Contains(f.files["/tmp/lantern-extra.env"], "LANTERN_LLM_KEY=k") {
		t.Fatal("ficheros auxiliares")
	}
	for _, w := range []string{"sudo -n bash /tmp/lantern-install.sh", "--version 'v1.0.0'", `--dm-name 'O'\''Neil'`, "--livekit", "--extra-env"} {
		if !strings.Contains(f.cmd, w) {
			t.Errorf("falta %q en %q", w, f.cmd)
		}
	}
	// segunda conexión con la misma huella: sin aviso; con otra huella: error
	logs = nil
	if _, err := Deploy(context.Background(), cfg, func(s string) { logs = append(logs, s) }); err != nil || strings.Contains(strings.Join(logs, ""), "primera conexión") {
		t.Fatalf("segunda: %v", err)
	}
	_, hk2, _ := ed25519.GenerateKey(rand.Reader)
	hs2, _ := ssh.NewSignerFromKey(hk2)
	f2 := startFake(t, hs2, 0)
	_, p2, _ := net.SplitHostPort(f2.addr)
	cfg.Port = 0
	for _, ch := range p2 {
		cfg.Port = cfg.Port*10 + int(ch-'0')
	}
	if _, err := Deploy(context.Background(), cfg, func(string) {}); err == nil || !strings.Contains(err.Error(), "huella") {
		t.Fatalf("esperaba error de huella: %v", err)
	}
}
