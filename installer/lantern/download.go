package lantern

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// DefaultReleases es la URL base de las descargas si no se indica otra (--releases / LANTERN_RELEASES).
// Son variables para fijarlas al compilar: -ldflags "-X lantern/installer/lantern.DefaultReleases=<url>" (tools/release/build.mjs --releases-url).
// Estructura Forgejo/Codeberg: <base>/<versión>/<archivo>; la última es <base sin /download>/latest/download.
var DefaultReleases = "https://github.com/lanterndevv/lantern/releases/download"

// DefaultImage es la imagen Docker del docker-compose generado (-X lantern/installer/lantern.DefaultImage=..., --image).
var DefaultImage = "ghcr.io/lanterndevv/lantern"

// AssetName es el nombre del binario del servidor para un os/arch de Go.
func AssetName(goos, goarch string) (string, error) {
	o := map[string]string{"linux": "linux", "darwin": "macos", "windows": "windows"}[goos]
	a := map[string]string{"amd64": "x64", "arm64": "arm64"}[goarch]
	if o == "" || a == "" {
		return "", fmt.Errorf("plataforma no soportada: %s/%s", goos, goarch)
	}
	n := "lantern-server-" + o + "-" + a
	if goos == "windows" {
		n += ".exe"
	}
	return n, nil
}

// ReleaseURL devuelve la carpeta de descarga para una versión ("" = la última).
func ReleaseURL(releases, version string) string {
	if releases == "" {
		releases = os.Getenv("LANTERN_RELEASES")
	}
	if releases == "" || releases == DefaultReleases {
		if version == "" {
			return strings.TrimSuffix(DefaultReleases, "/download") + "/latest/download"
		}
		return DefaultReleases + "/" + version
	}
	if version == "" {
		version = "latest"
	}
	return strings.TrimRight(releases, "/") + "/" + version
}

// ParseSums lee un SHA256SUMS ("hash  archivo" o "hash *archivo") y devuelve el hash de name.
func ParseSums(r io.Reader, name string) (string, bool) {
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) == 2 && strings.TrimPrefix(f[1], "*") == name {
			return strings.ToLower(f[0]), true
		}
	}
	return "", false
}

func get(ctx context.Context, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		resp.Body.Close()
		return nil, fmt.Errorf("%s: HTTP %d", url, resp.StatusCode)
	}
	return resp, nil
}

// InstallServer deja el binario en dest. Si localBin != "" lo copia; si no, lo descarga y verifica SHA256SUMS.
func InstallServer(ctx context.Context, localBin, releases, version, dest string) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	tmp := dest + ".new"
	if localBin != "" {
		src, err := os.Open(localBin)
		if err != nil {
			return err
		}
		defer src.Close()
		out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
		if err != nil {
			return err
		}
		if _, err = io.Copy(out, src); err != nil {
			out.Close()
			return err
		}
		if err = out.Close(); err != nil {
			return err
		}
		return os.Rename(tmp, dest)
	}
	name, err := AssetName(runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return err
	}
	base := ReleaseURL(releases, version)
	sr, err := get(ctx, base+"/SHA256SUMS")
	if err != nil {
		return fmt.Errorf("no se pudo obtener SHA256SUMS: %w", err)
	}
	want, ok := ParseSums(sr.Body, name)
	sr.Body.Close()
	if !ok {
		return fmt.Errorf("SHA256SUMS no incluye %s", name)
	}
	br, err := get(ctx, base+"/"+name)
	if err != nil {
		return err
	}
	defer br.Body.Close()
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	h := sha256.New()
	_, err = io.Copy(io.MultiWriter(out, h), br.Body)
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != want {
		os.Remove(tmp)
		return fmt.Errorf("SHA256 no coincide para %s (esperado %s, obtenido %s): descarga descartada", name, want, got)
	}
	return os.Rename(tmp, dest)
}
