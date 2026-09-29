package remote

import (
	"context"
	"encoding/json"
	"path/filepath"

	"lantern/installer/model"
)

func llmEnv(m map[string]string, p string, l *model.LLM) {
	if l == nil {
		return
	}
	m[p+"_FORMAT"], m[p+"_URL"], m[p+"_KEY"], m[p+"_MODEL"] = l.Format, l.URL, l.Key, l.Model
	if len(l.Headers) > 0 {
		h, _ := json.Marshal(l.Headers)
		m[p+"_HEADERS"] = string(h)
	}
}

// FromModel traduce la config del asistente a la de este paquete.
func FromModel(c model.Config) Config {
	env := map[string]string{}
	llmEnv(env, "LANTERN_LLM", c.LLM)
	llmEnv(env, "LANTERN_LLM2", c.LLM2)
	return Config{Host: c.SSHHost, User: c.SSHUser, KeyPath: c.SSHKeyPath, KnownHostsPath: filepath.Join(c.DataDir, "known_hosts"),
		Domain: c.Domain, ReleasesURL: c.Releases, Version: c.Version, AppPort: c.Port, Laya: c.Laya,
		DMName: c.DMName, Title: c.Title, ExtraEnv: env}
}

// DeployModel implementa model.Deployer (usar con model.DeployFunc(remote.DeployModel)) para el modo "oracle".
func DeployModel(ctx context.Context, c model.Config, log func(string)) (model.Result, error) {
	r, err := Deploy(ctx, FromModel(c), log)
	return model.Result{Code: r.Code, InviteURL: r.InviteURL, DMURL: r.DMURL, Origin: r.URL}, err
}
