// Package model contiene los tipos compartidos entre la UI, los modos de alojamiento
// (local, remote/, cloud/) y el motor de instalación.
package model

import "context"

// LLM describe un proveedor de IA de texto ya validado.
type LLM struct {
	ID      string            `json:"id,omitempty"`
	Format  string            `json:"format,omitempty"` // openai|anthropic|gemini
	URL     string            `json:"url,omitempty"`
	Key     string            `json:"key,omitempty"`
	Model   string            `json:"model,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
}

// Config es todo lo que el asistente recoge. También es el formato de --answers.
type Config struct {
	Lang    string `json:"lang,omitempty"` // es|en
	Mode    string `json:"mode"`           // local|oracle|vps|lan
	Tunnel  string `json:"tunnel"`         // quick|named|none (solo local)
	Domain  string `json:"domain,omitempty"`
	Port    int    `json:"port,omitempty"`
	DataDir string `json:"data_dir,omitempty"`

	ServerBin string `json:"server_bin,omitempty"`
	Releases  string `json:"releases,omitempty"`
	Version   string `json:"version,omitempty"`
	NoService bool   `json:"no_service,omitempty"` // no registra servicio del SO: proceso desacoplado
	Linger    bool   `json:"linger,omitempty"`     // Linux: loginctl enable-linger

	LLM  *LLM `json:"llm,omitempty"`
	LLM2 *LLM `json:"llm2,omitempty"`
	Laya bool `json:"laya,omitempty"`

	DMName     string `json:"dm_name"`
	Title      string `json:"title,omitempty"`
	ImportPath string `json:"import_path,omitempty"`

	// Modos remotos (los rellena la UI; los consumen remote/ y cloud/).
	SSHHost       string `json:"ssh_host,omitempty"`
	SSHUser       string `json:"ssh_user,omitempty"`
	SSHKeyPath    string `json:"ssh_key,omitempty"`
	CloudProvider string `json:"cloud_provider,omitempty"` // hetzner|digitalocean
	CloudToken    string `json:"cloud_token,omitempty"`
	Docker        bool   `json:"docker,omitempty"` // red local/NAS: generar docker-compose en vez de instalar
}

// Result es lo que devuelve una instalación.
type Result struct {
	Code      string
	InviteURL string
	DMURL     string
	Origin    string
}

// Deployer es el punto de entrada de los modos de alojamiento no locales.
// log recibe líneas de progreso (nunca secretos).
type Deployer interface {
	Deploy(ctx context.Context, cfg Config, log func(string)) (Result, error)
}

// DeployFunc adapta una función a Deployer.
type DeployFunc func(ctx context.Context, cfg Config, log func(string)) (Result, error)

func (f DeployFunc) Deploy(ctx context.Context, cfg Config, log func(string)) (Result, error) {
	return f(ctx, cfg, log)
}
