// Package ai: catálogo de proveedores de IA, cliente de prueba (openai/anthropic/gemini) y Laya local.
package ai

import (
	_ "embed"
	"encoding/json"
	"strings"
)

//go:embed providers.json
var catalogJSON []byte

type Param struct {
	ID      string `json:"id"`
	LabelES string `json:"label_es"`
	LabelEN string `json:"label_en"`
}

type Provider struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Group       string            `json:"group"` // free|subscription|paid|local
	Format      string            `json:"format"`
	BaseURL     string            `json:"base_url"`
	Headers     map[string]string `json:"headers"`
	KeyURL      string            `json:"key_url"`
	StepsES     []string          `json:"steps_es"`
	StepsEN     []string          `json:"steps_en"`
	CostES      string            `json:"cost_es"`
	CostEN      string            `json:"cost_en"`
	TermsES     string            `json:"terms_es"`
	TermsEN     string            `json:"terms_en"`
	TosURL      string            `json:"tos_url"`
	Model       string            `json:"model"`
	ModelFilter string            `json:"model_filter"`
	Enabled     bool              `json:"enabled"`
	Verify      bool              `json:"verify"`
	NeedsKey    bool              `json:"needs_key"`
	Params      []Param           `json:"params"`
}

// Load devuelve el catálogo embebido.
func Load() ([]Provider, error) {
	var c struct {
		Providers []Provider `json:"providers"`
	}
	err := json.Unmarshal(catalogJSON, &c)
	return c.Providers, err
}

// Groups es el orden de presentación.
var Groups = []string{"free", "subscription", "paid", "local"}

// Resolve sustituye {param} en la URL (o la reemplaza si hay un param base_url).
func (p Provider) Resolve(params map[string]string) string {
	u := p.BaseURL
	if v := params["base_url"]; v != "" {
		u = v
	}
	for k, v := range params {
		u = strings.ReplaceAll(u, "{"+k+"}", v)
	}
	return strings.TrimRight(u, "/")
}
