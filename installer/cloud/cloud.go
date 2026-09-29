// Package cloud crea VPS por API (Hetzner, DigitalOcean) y guía la alta manual en Oracle.
package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Server es lo mínimo que necesita el instalador de un VPS recién creado.
type Server struct {
	ID   int64
	IP   string
	Name string
}

// Provider lo implementan Hetzner y DigitalOcean.
type Provider interface {
	Create(ctx context.Context, name, sshPubKey, userData string, log func(string)) (Server, error)
	Delete(ctx context.Context, id int64) error
}

// Info: precio aproximado y ayuda para el token (ES/EN).
type Info struct {
	Name, TokenURL string
	Price          map[string]string // "es"/"en"
	TokenSteps     map[string]string // "es"/"en"; líneas «• » = pasos
}

var (
	HetznerInfo = Info{"Hetzner Cloud", "https://console.hetzner.cloud/", map[string]string{
		"es": "Unos 4-5 EUR al mes (IVA aparte)", "en": "About 4-5 EUR per month (VAT extra)"}, map[string]string{
		"es": "• Pulsa «o» para abrir «console.hetzner.cloud» e inicia sesión (o crea una cuenta).\n• Crea un proyecto con «New project»: vale cualquier nombre.\n• Dentro del proyecto: «Security» > «API tokens» > «Generate API token».\n• En «Permissions» elige «Read & Write», ponle un nombre y pulsa «Generate API token».\n• Copia el token que aparece: solo se muestra una vez.",
		"en": "• Press \"o\" to open \"console.hetzner.cloud\" and sign in (or create an account).\n• Create a project with \"New project\": any name works.\n• Inside the project: \"Security\" > \"API tokens\" > \"Generate API token\".\n• Under \"Permissions\" pick \"Read & Write\", give it a name and click \"Generate API token\".\n• Copy the token shown: it is displayed only once."}}
	DigitalOceanInfo = Info{"DigitalOcean", "https://cloud.digitalocean.com/account/api/tokens", map[string]string{
		"es": "Unos 6 USD al mes", "en": "About 6 USD per month"}, map[string]string{
		"es": "• Pulsa «o» para abrir la página de tokens e inicia sesión (o crea una cuenta; piden tarjeta).\n• Pulsa «Generate New Token» y ponle un nombre.\n• En los permisos («Scopes») elige «Full Access» (o «Custom» con escritura en «droplet» y «ssh_key»).\n• Pulsa «Generate Token» y copia el token: solo se muestra una vez.",
		"en": "• Press \"o\" to open the tokens page and sign in (or create an account; a card is required).\n• Click \"Generate New Token\" and give it a name.\n• Under \"Scopes\" pick \"Full Access\" (or \"Custom\" with write on \"droplet\" and \"ssh_key\").\n• Click \"Generate Token\" and copy the token: it is displayed only once."}}
)

// doJSON hace la petición y decodifica la respuesta; los códigos >=300 devuelven error con el cuerpo.
func doJSON(ctx context.Context, hc *http.Client, method, url, token string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, _ := json.Marshal(in)
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	r, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	if r.StatusCode >= 300 {
		return fmt.Errorf("%s %s: HTTP %d: %s", method, url, r.StatusCode, strings.TrimSpace(string(b)))
	}
	if out != nil {
		return json.Unmarshal(b, out)
	}
	return nil
}

func poll(ctx context.Context, every time.Duration, tries int, f func() (bool, error)) error {
	for i := 0; i < tries; i++ {
		if ok, err := f(); err != nil || ok {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(every):
		}
	}
	return fmt.Errorf("tiempo agotado esperando al servidor")
}

func itoa(i int64) string { return strconv.FormatInt(i, 10) }
