// Lantern: asistente de instalación y panel de control.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"

	"lantern/installer/engine"
	"lantern/installer/model"
	"lantern/installer/platform"
	"lantern/installer/ui"
)

var version = "dev" // -ldflags "-X main.version=1.0.0"

func lang() string {
	for _, k := range []string{"LC_ALL", "LC_MESSAGES", "LANG"} {
		if v := os.Getenv(k); v != "" && v != "C" && v != "POSIX" {
			if strings.HasPrefix(strings.ToLower(v), "es") {
				return "es"
			}
			return "en"
		}
	}
	return "es"
}

func main() {
	fs := flag.NewFlagSet("lantern", flag.ExitOnError)
	answers := fs.String("answers", "", "archivo JSON con las respuestas (modo no interactivo)")
	serverBin := fs.String("server-bin", "", "usar este binario lantern-server en lugar de descargarlo")
	releases := fs.String("releases", "", "URL base de las releases (o env LANTERN_RELEASES)")
	dataDir := fs.String("data-dir", "", "carpeta de datos (por defecto, la del sistema)")
	noService := fs.Bool("no-service", false, "no registrar servicio del SO: proceso en segundo plano")
	fs.Usage = func() {
		fmt.Fprintln(os.Stderr, "uso: lantern [opciones] [version]\n\nSin argumentos abre el panel (si ya está instalado) o el asistente.")
		fs.PrintDefaults()
	}
	args := os.Args[1:]
	if len(args) > 0 && args[0] == "version" {
		fmt.Println(version)
		return
	}
	_ = fs.Parse(args)
	if fs.Arg(0) == "version" {
		fmt.Println(version)
		return
	}
	dd := *dataDir
	if dd == "" {
		dd = platform.DefaultDataDir()
	}
	paths := platform.Paths{Data: dd}
	base := model.Config{ServerBin: *serverBin, Releases: *releases, DataDir: dd, NoService: *noService}

	if *answers != "" {
		if err := nonInteractive(*answers, base); err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			os.Exit(1)
		}
		return
	}
	if err := ui.Run(ui.Options{Paths: paths, Base: base, Deployers: deployers, Panel: paths.Installed(), Lang: lang()}); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

// nonInteractive instala según un JSON de respuestas (CI/tests). El resultado sale por stdout como JSON.
func nonInteractive(file string, base model.Config) error {
	b, err := os.ReadFile(file)
	if err != nil {
		return err
	}
	var c model.Config
	if err := json.Unmarshal(b, &c); err != nil {
		return fmt.Errorf("%s: %w", file, err)
	}
	if base.ServerBin != "" {
		c.ServerBin = base.ServerBin
	}
	if base.Releases != "" {
		c.Releases = base.Releases
	}
	if base.DataDir != "" {
		c.DataDir = base.DataDir
	}
	c.NoService = c.NoService || base.NoService
	if c.Mode == "" {
		c.Mode = "local"
	}
	if c.Mode == "local" && c.Tunnel == "" {
		c.Tunnel = "quick"
	}
	if c.Mode != "local" {
		c.Tunnel = "none"
	}
	if c.DMName == "" {
		c.DMName = "DM"
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	var res model.Result
	if d := deployers[c.Mode]; d != nil {
		res, err = d.Deploy(ctx, c, func(l string) { fmt.Fprintln(os.Stderr, l) })
	} else {
		plan := engine.Plan(c)
		res, err = engine.Run(ctx, c, func(i int, m string) {
			if m != "" {
				fmt.Fprintf(os.Stderr, "[%s] %s\n", plan[i].ID, m)
			} else {
				fmt.Fprintf(os.Stderr, "[%s] %s\n", plan[i].ID, plan[i].EN)
			}
		})
	}
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]string{"code": res.Code, "inviteUrl": res.InviteURL, "dmUrl": res.DMURL, "origin": res.Origin})
}
