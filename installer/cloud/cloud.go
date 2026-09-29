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
	Name, TokenURL, Price string
	TokenSteps            map[string]string // "es"/"en"
}

var (
	HetznerInfo = Info{"Hetzner Cloud", "https://console.hetzner.cloud/", "~4-5 EUR/mes (CX22 x86 ~4 EUR, CAX11 Arm ~4 EUR; IVA aparte)", map[string]string{
		"es": "1. Entra en https://console.hetzner.cloud/ y crea un proyecto.\n2. Seguridad > Tokens de API > Generar token API.\n3. Permisos: Lectura y escritura. Copia el token (solo se muestra una vez) y pégalo aquí.",
		"en": "1. Open https://console.hetzner.cloud/ and create a project.\n2. Security > API tokens > Generate API token.\n3. Permissions: Read & Write. Copy the token (shown only once) and paste it here."}}
	DigitalOceanInfo = Info{"DigitalOcean", "https://cloud.digitalocean.com/account/api/tokens", "~6 USD/mes (droplet s-1vcpu-1gb)", map[string]string{
		"es": "1. Entra en https://cloud.digitalocean.com/account/api/tokens\n2. Generate New Token, permisos Read y Write (o personalizado: droplet y ssh_key).\n3. Copia el token y pégalo aquí.",
		"en": "1. Open https://cloud.digitalocean.com/account/api/tokens\n2. Generate New Token with Read and Write scopes (or custom: droplet and ssh_key).\n3. Copy the token and paste it here."}}
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
