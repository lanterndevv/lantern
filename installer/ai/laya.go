package ai

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// UVAsset es el archivo de astral-sh/uv para un os/arch de Go.
func UVAsset(goos, goarch string) (string, error) {
	a := map[string]string{"amd64": "x86_64", "arm64": "aarch64"}[goarch]
	if a == "" {
		return "", fmt.Errorf("arquitectura no soportada por uv: %s", goarch)
	}
	switch goos {
	case "linux":
		return "uv-" + a + "-unknown-linux-gnu.tar.gz", nil
	case "darwin":
		return "uv-" + a + "-apple-darwin.tar.gz", nil
	case "windows":
		return "uv-" + a + "-pc-windows-msvc.zip", nil
	}
	return "", fmt.Errorf("SO no soportado: %s", goos)
}

func fetch(ctx context.Context, url string) (io.ReadCloser, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		resp.Body.Close()
		return nil, fmt.Errorf("%s: HTTP %d", url, resp.StatusCode)
	}
	return resp.Body, nil
}

// InstallUV descarga uv (verificando su .sha256 oficial) y deja el binario en binDir.
func InstallUV(ctx context.Context, binDir string) (string, error) {
	asset, err := UVAsset(runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return "", err
	}
	name := "uv"
	if runtime.GOOS == "windows" {
		name = "uv.exe"
	}
	dest := filepath.Join(binDir, name)
	if _, err := os.Stat(dest); err == nil {
		return dest, nil
	}
	base := "https://github.com/astral-sh/uv/releases/latest/download/" + asset
	body, err := fetch(ctx, base)
	if err != nil {
		return "", err
	}
	defer body.Close()
	tmp, err := os.CreateTemp("", "uv-*-"+asset)
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name())
	h := sha256.New()
	if _, err := io.Copy(io.MultiWriter(tmp, h), body); err != nil {
		return "", err
	}
	tmp.Close()
	if sb, err := fetch(ctx, base+".sha256"); err == nil {
		b, _ := io.ReadAll(io.LimitReader(sb, 1024))
		sb.Close()
		if f := strings.Fields(string(b)); len(f) > 0 && !strings.EqualFold(f[0], hex.EncodeToString(h.Sum(nil))) {
			return "", fmt.Errorf("SHA256 de uv no coincide: descarga descartada")
		}
	}
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		return "", err
	}
	if err := extractOne(tmp.Name(), name, dest); err != nil {
		return "", err
	}
	return dest, nil
}

// extractOne saca el archivo llamado want (en cualquier subcarpeta) de un .tar.gz o .zip (por sufijo del nombre temporal).
func extractOne(archive, want, dest string) error {
	write := func(r io.Reader) error {
		out, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
		if err != nil {
			return err
		}
		_, err = io.Copy(out, r)
		if cerr := out.Close(); err == nil {
			err = cerr
		}
		return err
	}
	if strings.HasSuffix(archive, ".zip") {
		z, err := zip.OpenReader(archive)
		if err != nil {
			return err
		}
		defer z.Close()
		for _, f := range z.File {
			if filepath.Base(f.Name) == want {
				r, err := f.Open()
				if err != nil {
					return err
				}
				defer r.Close()
				return write(r)
			}
		}
		return fmt.Errorf("%s no está en el zip", want)
	}
	f, err := os.Open(archive)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	tr := tar.NewReader(gz)
	for {
		h, err := tr.Next()
		if err != nil {
			return fmt.Errorf("%s no está en el tar.gz", want)
		}
		if filepath.Base(h.Name) == want && h.Typeflag == tar.TypeReg {
			return write(tr)
		}
	}
}

func tail(s string) string {
	if len(s) > 600 {
		return s[len(s)-600:]
	}
	return s
}

// InstallLaya crea el venv con Python gestionado por uv, torch CPU y laya, precarga el modelo
// y devuelve la ruta del python del venv (LANTERN_LAYA_PYTHON).
func InstallLaya(ctx context.Context, dataDir string, log func(string)) (string, error) {
	uv, err := InstallUV(ctx, filepath.Join(dataDir, "bin"))
	if err != nil {
		return "", err
	}
	venv := filepath.Join(dataDir, "laya-venv")
	py := filepath.Join(venv, "bin", "python")
	if runtime.GOOS == "windows" {
		py = filepath.Join(venv, "Scripts", "python.exe")
	}
	env := append(os.Environ(), "UV_PYTHON_INSTALL_DIR="+filepath.Join(dataDir, "python"), "UV_CACHE_DIR="+filepath.Join(dataDir, "uv-cache"))
	step := func(msg string, args ...string) error {
		log(msg)
		c := exec.CommandContext(ctx, uv, args...)
		c.Env = env
		if out, err := c.CombinedOutput(); err != nil {
			return fmt.Errorf("%s: %w\n%s", msg, err, tail(string(out)))
		}
		return nil
	}
	if err := step("Creando entorno de Python (uv)…", "venv", "--python", "3.12", "--managed-python", venv); err != nil {
		return "", err
	}
	if err := step("Instalando torch (CPU)…", "pip", "install", "--python", py, "torch", "--index-url", "https://download.pytorch.org/whl/cpu"); err != nil {
		return "", err
	}
	if err := step("Instalando laya…", "pip", "install", "--python", py, "laya"); err != nil {
		return "", err
	}
	log("Descargando el modelo de Laya…")
	c := exec.CommandContext(ctx, py, "-c", "from laya import Router; Router(device='cpu').preload(['english'])")
	c.Env = env
	if out, err := c.CombinedOutput(); err != nil {
		return "", fmt.Errorf("precarga de Laya: %w\n%s", err, tail(string(out)))
	}
	return py, nil
}
