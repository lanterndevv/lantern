// Package platform: rutas por sistema operativo y gestión de servicios de usuario.
package platform

import (
	"os"
	"path/filepath"
	"runtime"
)

// Paths agrupa las rutas de una instalación.
type Paths struct{ Data string }

// DefaultDataDir es os.UserConfigDir()/Lantern (~/.config/Lantern en Linux).
func DefaultDataDir() string {
	d, err := os.UserConfigDir()
	if err != nil {
		h, _ := os.UserHomeDir()
		d = filepath.Join(h, ".config")
	}
	return filepath.Join(d, "Lantern")
}

func exe(name string) string {
	if runtime.GOOS == "windows" {
		return name + ".exe"
	}
	return name
}

func (p Paths) Env() string         { return filepath.Join(p.Data, "lantern.env") }
func (p Paths) Bin() string         { return filepath.Join(p.Data, "bin") }
func (p Paths) Server() string      { return filepath.Join(p.Bin(), exe("lantern-server")) }
func (p Paths) Cloudflared() string { return filepath.Join(p.Bin(), exe("cloudflared")) }
func (p Paths) Logs() string        { return filepath.Join(p.Data, "logs") }
func (p Paths) Log(svc string) string {
	return filepath.Join(p.Logs(), svc+".log")
}
func (p Paths) Pid(svc string) string { return filepath.Join(p.Data, "run", svc+".pid") }
func (p Paths) DB() string            { return filepath.Join(p.Data, "lantern.db") }
func (p Paths) Assets() string        { return filepath.Join(p.Data, "assets") }
func (p Paths) Backups() string       { return filepath.Join(p.Data, "backups") }

// Installed indica si ya hay una instalación (existe lantern.env).
func (p Paths) Installed() bool {
	_, err := os.Stat(p.Env())
	return err == nil
}
