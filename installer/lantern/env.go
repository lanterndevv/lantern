// Package lantern gestiona el binario del servidor, su lantern.env y el cliente /admin/*.
package lantern

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// ReadEnv lee un lantern.env (CLAVE=valor, # comentarios). Si no existe devuelve un mapa vacío.
func ReadEnv(path string) map[string]string {
	m := map[string]string{}
	f, err := os.Open(path)
	if err != nil {
		return m
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		l := strings.TrimSpace(sc.Text())
		if l == "" || l[0] == '#' {
			continue
		}
		if k, v, ok := strings.Cut(l, "="); ok {
			m[strings.TrimSpace(k)] = strings.TrimSpace(v)
		}
	}
	return m
}

// WriteEnv escribe el archivo de forma atómica con permisos 600. Las claves con valor vacío se omiten.
func WriteEnv(path string, m map[string]string) error {
	keys := make([]string, 0, len(m))
	for k, v := range m {
		if v != "" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	var b strings.Builder
	b.WriteString("# Generado por el instalador de Lantern. Contiene secretos: no lo compartas.\n")
	for _, k := range keys {
		b.WriteString(k + "=" + strings.ReplaceAll(m[k], "\n", "") + "\n")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(b.String()), 0o600); err != nil {
		return err
	}
	if err := os.Chmod(tmp, 0o600); err != nil {
		return err
	}
	if runtime.GOOS == "windows" { // ACL: solo el usuario actual
		if u := os.Getenv("USERNAME"); u != "" {
			_ = exec.Command("icacls", tmp, "/inheritance:r", "/grant:r", u+":F").Run()
		}
	}
	return os.Rename(tmp, path)
}

// RandomToken devuelve 32 bytes aleatorios en hexadecimal.
func RandomToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
