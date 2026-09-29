package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

// Endpoint es un proveedor ya resuelto (URL final, clave). La clave nunca se registra ni se incluye en errores.
type Endpoint struct {
	Format  string
	URL     string
	Key     string
	Headers map[string]string
	HTTP    *http.Client
}

type HTTPError struct {
	Status int
	Body   string
}

func (h *HTTPError) Error() string { return fmt.Sprintf("HTTP %d: %s", h.Status, h.Body) }

func (e Endpoint) call(ctx context.Context, method, path string, body any, out any) error {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(e.URL, "/")+path, rd)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("content-type", "application/json")
	}
	switch e.Format {
	case "anthropic":
		req.Header.Set("x-api-key", e.Key)
		req.Header.Set("anthropic-version", "2023-06-01")
	case "gemini":
		req.Header.Set("x-goog-api-key", e.Key)
	default:
		if e.Key != "" {
			req.Header.Set("authorization", "Bearer "+e.Key)
		}
	}
	for k, v := range e.Headers {
		req.Header.Set(k, v)
	}
	c := e.HTTP
	if c == nil {
		c = &http.Client{Timeout: 60 * time.Second}
	}
	resp, err := c.Do(req)
	if err != nil {
		msg := err.Error()
		if e.Key != "" {
			msg = strings.ReplaceAll(msg, e.Key, "***")
		}
		return errors.New("sin conexión con " + e.URL + ": " + msg)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode/100 != 2 {
		msg := strings.TrimSpace(string(b))
		if len(msg) > 300 {
			msg = msg[:300]
		}
		if e.Key != "" {
			msg = strings.ReplaceAll(msg, e.Key, "***")
		}
		return &HTTPError{Status: resp.StatusCode, Body: msg}
	}
	return json.Unmarshal(b, out)
}

// ListModels valida la clave y devuelve los ids de modelo ordenados. filter (opcional) exige subcadena.
func (e Endpoint) ListModels(ctx context.Context, filter string) ([]string, error) {
	var ids []string
	switch e.Format {
	case "gemini":
		var r struct {
			Models []struct {
				Name    string   `json:"name"`
				Methods []string `json:"supportedGenerationMethods"`
			} `json:"models"`
		}
		if err := e.call(ctx, "GET", "/v1beta/models?pageSize=200", nil, &r); err != nil {
			return nil, err
		}
		for _, m := range r.Models {
			gen := len(m.Methods) == 0
			for _, x := range m.Methods {
				gen = gen || x == "generateContent"
			}
			if gen {
				ids = append(ids, strings.TrimPrefix(m.Name, "models/"))
			}
		}
	case "anthropic":
		var r struct{ Data []struct{ ID string } }
		if err := e.call(ctx, "GET", "/v1/models?limit=100", nil, &r); err != nil {
			return nil, err
		}
		for _, m := range r.Data {
			ids = append(ids, m.ID)
		}
	default:
		var r struct{ Data []struct{ ID string } }
		if err := e.call(ctx, "GET", "/models", nil, &r); err != nil {
			return nil, err
		}
		for _, m := range r.Data {
			ids = append(ids, m.ID)
		}
	}
	if filter != "" {
		keep := ids[:0]
		for _, id := range ids {
			if strings.Contains(id, filter) {
				keep = append(keep, id)
			}
		}
		ids = keep
	}
	sort.Strings(ids)
	return ids, nil
}

// Chat hace una prueba corta y devuelve el texto de la respuesta.
func (e Endpoint) Chat(ctx context.Context, model, prompt string) (string, error) {
	msgs := []any{map[string]string{"role": "user", "content": prompt}}
	switch e.Format {
	case "gemini":
		var r struct {
			Candidates []struct {
				Content struct{ Parts []struct{ Text string } }
			}
		}
		body := map[string]any{"contents": []any{map[string]any{"parts": []any{map[string]string{"text": prompt}}}}}
		if err := e.call(ctx, "POST", "/v1beta/models/"+model+":generateContent", body, &r); err != nil {
			return "", err
		}
		if len(r.Candidates) > 0 && len(r.Candidates[0].Content.Parts) > 0 {
			return r.Candidates[0].Content.Parts[0].Text, nil
		}
	case "anthropic":
		var r struct{ Content []struct{ Text string } }
		if err := e.call(ctx, "POST", "/v1/messages", map[string]any{"model": model, "max_tokens": 64, "messages": msgs}, &r); err != nil {
			return "", err
		}
		if len(r.Content) > 0 {
			return r.Content[0].Text, nil
		}
	default:
		var r struct {
			Choices []struct{ Message struct{ Content string } }
		}
		if err := e.call(ctx, "POST", "/chat/completions", map[string]any{"model": model, "max_tokens": 64, "messages": msgs}, &r); err != nil {
			return "", err
		}
		if len(r.Choices) > 0 {
			return r.Choices[0].Message.Content, nil
		}
	}
	return "", errors.New("respuesta vacía del modelo")
}

// Explain traduce un error de proveedor a una recomendación clara.
func Explain(err error, es bool) string {
	pick := func(a, b string) string {
		if es {
			return a
		}
		return b
	}
	var h *HTTPError
	if errors.As(err, &h) {
		switch h.Status {
		case 400, 401, 403:
			return pick("La clave no es válida o no tiene permiso. Vuelve a copiarla completa.", "The key is invalid or lacks permission. Copy it again in full.")
		case 429:
			return pick("Has llegado al límite del plan. Espera un poco o elige otro proveedor.", "You hit the plan limit. Wait a bit or pick another provider.")
		case 404:
			return pick("No se encontró el recurso: revisa la URL base o el modelo.", "Resource not found: check the base URL or the model.")
		}
	}
	// Un cuerpo JSON largo no ayuda a nadie: una sola línea y corta.
	if t := strings.Join(strings.Fields(err.Error()), " "); len([]rune(t)) > 240 {
		return string([]rune(t)[:240]) + "…"
	} else {
		return t
	}
}
