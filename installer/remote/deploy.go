package remote

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

//go:embed install.sh
var InstallScript string

type Config struct {
	Host, User     string // User por defecto "ubuntu"
	Port           int    // SSH, por defecto 22
	KeyPath        string // clave privada (EnsureKey)
	KnownHostsPath string // fichero TOFU propio (huella por host)
	Domain         string // vacío => <ip-con-guiones>.sslip.io
	ReleasesURL    string
	Version        string
	AppPort        int // por defecto 8787
	LiveKit, Laya  bool
	DMName, Title  string
	ExtraEnv       map[string]string // p.ej. LANTERN_LLM_*; se escribe en lantern.env
	ConnectTimeout time.Duration     // espera total a que la VM acepte SSH (def. 10 min)
	RetryEvery     time.Duration     // def. 10 s
}

type Result struct {
	Domain, URL, Code, InviteURL, DMURL string
	PortsOpen                           bool // 80 y 443 accesibles desde fuera
}

// SSLIPDomain: 1.2.3.4 -> 1-2-3-4.sslip.io
func SSLIPDomain(ip string) string { return strings.ReplaceAll(ip, ".", "-") + ".sslip.io" }

// Caddyfile genera la configuración de Caddy: HTTPS automático y proxy a Lantern (y LiveKit en /livekit).
func Caddyfile(domain string, port int, livekit bool) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s {\n\tencode zstd gzip\n", domain)
	if livekit {
		b.WriteString("\thandle_path /livekit/* {\n\t\treverse_proxy 127.0.0.1:7880\n\t}\n")
	}
	fmt.Fprintf(&b, "\treverse_proxy 127.0.0.1:%d\n}\n", port)
	return b.String()
}

var ErrHostKeyChanged = errors.New("la huella del servidor ha cambiado (posible suplantación); si reinstalaste la VM, borra su línea en el fichero de huellas")

var tofuMu sync.Mutex

// tofuCallback recuerda la huella la primera vez (con aviso) y la exige después.
func tofuCallback(path string, log func(string)) ssh.HostKeyCallback {
	return func(host string, _ net.Addr, key ssh.PublicKey) error {
		fp := ssh.FingerprintSHA256(key)
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h // la huella es del equipo, no del puerto
		}
		tofuMu.Lock()
		defer tofuMu.Unlock()
		data, _ := os.ReadFile(path)
		for _, l := range strings.Split(string(data), "\n") {
			f := strings.Fields(l)
			if len(f) == 2 && f[0] == host {
				if f[1] == fp {
					return nil
				}
				return fmt.Errorf("%w: %s (guardada %s, ahora %s)", ErrHostKeyChanged, host, f[1], fp)
			}
		}
		log(fmt.Sprintf("AVISO: primera conexión con %s; se guarda su huella %s (TOFU).", host, fp))
		f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = fmt.Fprintf(f, "%s %s\n", host, fp)
		return err
	}
}

func dial(ctx context.Context, c Config, log func(string)) (*ssh.Client, error) {
	keyb, err := os.ReadFile(c.KeyPath)
	if err != nil {
		return nil, err
	}
	signer, err := ssh.ParsePrivateKey(keyb)
	if err != nil {
		return nil, err
	}
	cc := &ssh.ClientConfig{User: c.User, Auth: []ssh.AuthMethod{ssh.PublicKeys(signer)},
		HostKeyCallback: tofuCallback(c.KnownHostsPath, log), Timeout: 15 * time.Second}
	addr := net.JoinHostPort(c.Host, strconv.Itoa(c.Port))
	deadline := time.Now().Add(c.ConnectTimeout)
	for n := 1; ; n++ {
		cl, err := ssh.Dial("tcp", addr, cc)
		if err == nil {
			return cl, nil
		}
		// una huella cambiada o un fallo de fichero no se arreglan reintentando
		if errors.Is(err, ErrHostKeyChanged) || errors.Is(err, os.ErrPermission) || time.Now().After(deadline) {
			return nil, err
		}
		log(fmt.Sprintf("esperando a que la VM acepte SSH (intento %d): %v", n, err))
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(c.RetryEvery):
		}
	}
}

func put(cl *ssh.Client, path string, mode os.FileMode, content string) error {
	s, err := cl.NewSession()
	if err != nil {
		return err
	}
	defer s.Close()
	s.Stdin = strings.NewReader(content)
	out, err := s.CombinedOutput(fmt.Sprintf("umask 077; cat > %s && chmod %o %s", path, mode, path))
	if err != nil {
		return fmt.Errorf("subir %s: %v %s", path, err, out)
	}
	return nil
}

func shq(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

// InstallCommand construye la línea que se ejecuta en el servidor.
func InstallCommand(c Config, sudo bool) string {
	a := []string{"bash", "/tmp/lantern-install.sh", "--releases", shq(c.ReleasesURL), "--version", shq(c.Version),
		"--port", strconv.Itoa(c.AppPort), "--domain", shq(c.Domain), "--dm-name", shq(c.DMName), "--title", shq(c.Title),
		"--caddyfile", "/tmp/lantern-Caddyfile"}
	if len(c.ExtraEnv) > 0 {
		a = append(a, "--extra-env", "/tmp/lantern-extra.env")
	}
	if c.LiveKit {
		a = append(a, "--livekit")
	}
	if c.Laya {
		a = append(a, "--laya")
	}
	cmd := strings.Join(a, " ")
	if sudo {
		cmd = "sudo -n " + cmd
	}
	return cmd
}

func (c *Config) defaults() {
	if c.User == "" {
		c.User = "ubuntu"
	}
	if c.Port == 0 {
		c.Port = 22
	}
	if c.AppPort == 0 {
		c.AppPort = 8787
	}
	if c.Domain == "" {
		c.Domain = SSLIPDomain(c.Host)
	}
	if c.DMName == "" {
		c.DMName = "DM"
	}
	if c.Title == "" {
		c.Title = "Mesa de Lantern"
	}
	if c.ConnectTimeout == 0 {
		c.ConnectTimeout = 10 * time.Minute
	}
	if c.RetryEvery == 0 {
		c.RetryEvery = 10 * time.Second
	}
}

// Deploy conecta, sube y ejecuta install.sh, y comprueba desde fuera que 80/443 responden.
// Firma compatible con `Deployer.Deploy(ctx, cfg, log)` tras adaptar Config.
func Deploy(ctx context.Context, c Config, log func(string)) (Result, error) {
	c.defaults()
	res := Result{Domain: c.Domain, URL: "https://" + c.Domain}
	cl, err := dial(ctx, c, log)
	if err != nil {
		return res, fmt.Errorf("conectar por SSH a %s: %w", c.Host, err)
	}
	defer cl.Close()
	if err := put(cl, "/tmp/lantern-install.sh", 0o700, InstallScript); err != nil {
		return res, err
	}
	if err := put(cl, "/tmp/lantern-Caddyfile", 0o600, Caddyfile(c.Domain, c.AppPort, c.LiveKit)); err != nil {
		return res, err
	}
	if len(c.ExtraEnv) > 0 {
		var b strings.Builder
		for k, v := range c.ExtraEnv {
			fmt.Fprintf(&b, "%s=%s\n", k, strings.ReplaceAll(v, "\n", " "))
		}
		if err := put(cl, "/tmp/lantern-extra.env", 0o600, b.String()); err != nil {
			return res, err
		}
	}
	out, err := run(ctx, cl, InstallCommand(c, c.User != "root"), log)
	if err != nil {
		return res, fmt.Errorf("install.sh falló: %w", err)
	}
	if i := strings.Index(out, "LANTERN_BOOTSTRAP "); i >= 0 {
		var b struct{ Code, InviteURL, DmURL string }
		line := strings.SplitN(out[i+len("LANTERN_BOOTSTRAP "):], "\n", 2)[0]
		if json.Unmarshal([]byte(line), &b) == nil {
			res.Code, res.InviteURL, res.DMURL = b.Code, b.InviteURL, b.DmURL
		}
	}
	res.PortsOpen = checkOutside(ctx, c.Host, c.Domain, log)
	return res, nil
}

// run ejecuta cmd volcando cada línea de stdout/stderr a log; devuelve la salida completa.
func run(ctx context.Context, cl *ssh.Client, cmd string, log func(string)) (string, error) {
	s, err := cl.NewSession()
	if err != nil {
		return "", err
	}
	defer s.Close()
	pr, pw := io.Pipe()
	s.Stdout, s.Stderr = pw, pw
	var all bytes.Buffer
	done := make(chan struct{})
	go func() {
		defer close(done)
		sc := bufio.NewScanner(pr)
		sc.Buffer(make([]byte, 1<<20), 1<<20)
		for sc.Scan() {
			all.WriteString(sc.Text() + "\n")
			if !strings.HasPrefix(sc.Text(), "LANTERN_BOOTSTRAP ") { // lleva la clave del DM: no al log
				log(sc.Text())
			}
		}
	}()
	go func() { <-ctx.Done(); s.Close() }()
	err = s.Run(cmd)
	pw.Close()
	<-done
	return all.String(), err
}

// checkOutside comprueba desde este equipo que 80 y 443 abren y que HTTPS responde /health.
func checkOutside(ctx context.Context, host, domain string, log func(string)) bool {
	for _, p := range []string{"80", "443"} {
		c, err := net.DialTimeout("tcp", net.JoinHostPort(host, p), 8*time.Second)
		if err != nil {
			log(fmt.Sprintf("El puerto %s no es accesible desde fuera (%v). En Oracle falta abrirlo en la Security List de la VCN.", p, err))
			return false
		}
		c.Close()
	}
	hc := &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{}}}
	for i := 0; i < 12 && ctx.Err() == nil; i++ { // Caddy tarda unos segundos en obtener el certificado
		if r, err := hc.Get("https://" + domain + "/health"); err == nil {
			r.Body.Close()
			if r.StatusCode == 200 {
				return true
			}
		}
		time.Sleep(5 * time.Second)
	}
	log("Puertos abiertos, pero HTTPS aún no responde; el certificado puede tardar un minuto más.")
	return true
}
