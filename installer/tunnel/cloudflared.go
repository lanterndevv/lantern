// Package tunnel descarga cloudflared y gestiona el enlace rápido y el túnel con nombre.
package tunnel

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const releaseBase = "https://github.com/cloudflare/cloudflared/releases/latest/download/"

// Asset devuelve el nombre del asset oficial de cloudflared para un os/arch de Go.
func Asset(goos, goarch string) (string, error) {
	if goarch != "amd64" && goarch != "arm64" {
		return "", fmt.Errorf("arquitectura no soportada por cloudflared: %s", goarch)
	}
	switch goos {
	case "linux":
		return "cloudflared-linux-" + goarch, nil
	case "darwin":
		return "cloudflared-darwin-" + goarch + ".tgz", nil
	case "windows":
		return "cloudflared-windows-" + goarch + ".exe", nil
	}
	return "", fmt.Errorf("SO no soportado: %s", goos)
}

// Download descarga cloudflared a dest (descomprime el .tgz de macOS).
// ponytail: cloudflare no publica SHA256SUMS; se confía en HTTPS de GitHub.
func Download(ctx context.Context, goos, goarch, dest string) error {
	a, err := Asset(goos, goarch)
	if err != nil {
		return err
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", releaseBase+a, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("descarga de cloudflared: HTTP %d", resp.StatusCode)
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	tmp := dest + ".new"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	var src io.Reader = resp.Body
	if strings.HasSuffix(a, ".tgz") {
		gz, err := gzip.NewReader(resp.Body)
		if err != nil {
			out.Close()
			return err
		}
		tr := tar.NewReader(gz)
		for {
			h, err := tr.Next()
			if err != nil {
				out.Close()
				return fmt.Errorf("cloudflared no está en el .tgz: %w", err)
			}
			if filepath.Base(h.Name) == "cloudflared" {
				src = tr
				break
			}
		}
	}
	_, err = io.Copy(out, src)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dest)
}

var quickRe = regexp.MustCompile(`https://[a-z0-9-]+\.trycloudflare\.com`)

// ExtractQuickURL devuelve la última URL trycloudflare que aparece en el texto del registro.
func ExtractQuickURL(log string) string {
	m := quickRe.FindAllString(log, -1)
	if len(m) == 0 {
		return ""
	}
	return m[len(m)-1]
}

// WaitQuickURL espera a que aparezca una URL en el archivo de registro del túnel rápido.
func WaitQuickURL(ctx context.Context, logFile string, timeout time.Duration) (string, error) {
	dl := time.Now().Add(timeout)
	for {
		if b, err := os.ReadFile(logFile); err == nil {
			if u := ExtractQuickURL(string(b)); u != "" {
				return u, nil
			}
		}
		if time.Now().After(dl) || ctx.Err() != nil {
			return "", fmt.Errorf("cloudflared no dio ningún enlace a tiempo (revisa %s)", logFile)
		}
		time.Sleep(500 * time.Millisecond)
	}
}

// QuickArgs son los argumentos del servicio del enlace rápido.
func QuickArgs(port int) []string {
	return []string{"tunnel", "--no-autoupdate", "--url", fmt.Sprintf("http://localhost:%d", port)}
}

// NamedArgs son los argumentos del servicio con nombre.
func NamedArgs(cfgFile string) []string {
	return []string{"tunnel", "--no-autoupdate", "--config", cfgFile, "run"}
}

var idRe = regexp.MustCompile(`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`)

// ExtractTunnelID saca el UUID de "Created tunnel X with id <uuid>".
func ExtractTunnelID(out string) string { return idRe.FindString(out) }

// Config genera el config.yml del túnel con nombre.
func Config(id, credsFile, hostname string, port int) string {
	return fmt.Sprintf("tunnel: %s\ncredentials-file: %s\ningress:\n  - hostname: %s\n    service: http://localhost:%d\n  - service: http_status:404\n", id, credsFile, hostname, port)
}

// SetupNamed hace login (abre el navegador), crea el túnel, enruta el DNS y escribe config.yml.
// Devuelve la ruta del config.yml. log recibe líneas de progreso.
func SetupNamed(ctx context.Context, bin, dataDir, hostname string, port int, log func(string)) (string, error) {
	sh := func(args ...string) (string, error) {
		c := exec.CommandContext(ctx, bin, args...)
		b, err := c.CombinedOutput()
		return string(b), err
	}
	home, _ := os.UserHomeDir()
	cert := filepath.Join(home, ".cloudflared", "cert.pem")
	if _, err := os.Stat(cert); err != nil {
		log("Abriendo el navegador para autorizar tu dominio en Cloudflare…")
		c := exec.CommandContext(ctx, bin, "tunnel", "login")
		out, _ := c.StdoutPipe()
		c.Stderr = c.Stdout
		if err := c.Start(); err != nil {
			return "", err
		}
		go func() { // muestra la URL de login por si el navegador no se abre solo
			buf := make([]byte, 4096)
			for {
				n, err := out.Read(buf)
				if u := regexp.MustCompile(`https://\S+`).FindString(string(buf[:n])); u != "" {
					log("Si no se abrió, visita: " + u)
				}
				if err != nil {
					return
				}
			}
		}()
		if err := c.Wait(); err != nil {
			return "", fmt.Errorf("cloudflared tunnel login falló: %w", err)
		}
	}
	name := "lantern"
	out, err := sh("tunnel", "create", name)
	id := ExtractTunnelID(out)
	if err != nil && strings.Contains(out, "already exists") {
		lo, lerr := sh("tunnel", "list", "-o", "json", "-n", name)
		var l []struct{ ID, Name string }
		if lerr == nil && json.Unmarshal([]byte(lo), &l) == nil && len(l) > 0 {
			id, err = l[0].ID, nil
		}
	}
	if err != nil || id == "" {
		return "", fmt.Errorf("no se pudo crear el túnel: %s", strings.TrimSpace(out))
	}
	log("Túnel creado. Enrutando " + hostname + "…")
	if o, err := sh("tunnel", "route", "dns", "--overwrite-dns", name, hostname); err != nil {
		return "", fmt.Errorf("no se pudo crear el DNS de %s: %s", hostname, strings.TrimSpace(o))
	}
	cfg := filepath.Join(dataDir, "cloudflared.yml")
	creds := filepath.Join(home, ".cloudflared", id+".json")
	return cfg, os.WriteFile(cfg, []byte(Config(id, creds, hostname, port)), 0o600)
}
