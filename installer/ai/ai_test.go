package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCatalog(t *testing.T) {
	ps, err := Load()
	if err != nil || len(ps) < 20 {
		t.Fatalf("catálogo: %d %v", len(ps), err)
	}
	seen := map[string]bool{}
	groups := map[string]int{}
	for _, p := range ps {
		if seen[p.ID] {
			t.Errorf("id duplicado %s", p.ID)
		}
		seen[p.ID] = true
		groups[p.Group]++
		if p.ID == "" || p.Name == "" || p.CostES == "" || p.CostEN == "" || len(p.StepsES) == 0 || len(p.StepsEN) == 0 {
			t.Errorf("%s: faltan campos obligatorios", p.ID)
		}
		if p.Format != "openai" && p.Format != "anthropic" && p.Format != "gemini" {
			t.Errorf("%s: formato %q", p.ID, p.Format)
		}
		if p.ID != "custom" && !strings.HasPrefix(p.BaseURL, "http") {
			t.Errorf("%s: base_url %q", p.ID, p.BaseURL)
		}
		if p.Group != "local" && (p.KeyURL == "" || p.Model == "") {
			t.Errorf("%s: falta key_url o modelo", p.ID)
		}
		if p.Group == "local" && p.NeedsKey {
			t.Errorf("%s: un local no necesita clave", p.ID)
		}
		if !p.Enabled && (p.TosURL == "" || !p.Verify) {
			t.Errorf("%s: desactivado exige tos_url y verify", p.ID)
		}
	}
	for _, g := range Groups {
		if groups[g] == 0 {
			t.Errorf("grupo vacío %s", g)
		}
	}
	for _, id := range []string{"gemini", "groq", "openrouter", "mistral", "sambanova", "cloudflare", "nvidia", "opencode-go", "zai-coding", "kimi-code", "minimax-coding", "anthropic", "openai", "deepseek", "xai", "moonshot", "zai", "minimax", "together", "fireworks", "ollama", "lmstudio", "llamacpp", "vllm", "custom"} {
		if !seen[id] {
			t.Errorf("falta %s", id)
		}
	}
	for _, p := range ps {
		if (p.ID == "zai-coding" || p.ID == "kimi-code" || p.ID == "minimax-coding") && p.Enabled {
			t.Errorf("%s debe estar desactivado hasta verificar", p.ID)
		}
		if p.ID == "cloudflare" && !strings.Contains(p.Resolve(map[string]string{"account_id": "abc"}), "/accounts/abc/") {
			t.Error("Resolve no sustituye account_id")
		}
	}
}

func TestOpenAIFormat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("authorization") != "Bearer k1" || r.Header.Get("x-opencode-session") != "s" {
			w.WriteHeader(401)
			w.Write([]byte("bad key k1"))
			return
		}
		switch r.URL.Path {
		case "/v1/models":
			w.Write([]byte(`{"data":[{"id":"b:free"},{"id":"a"},{"id":"c:free"}]}`))
		case "/v1/chat/completions":
			var b map[string]any
			json.NewDecoder(r.Body).Decode(&b)
			if b["model"] != "a" {
				w.WriteHeader(404)
				return
			}
			w.Write([]byte(`{"choices":[{"message":{"content":"listo"}}]}`))
		}
	}))
	defer srv.Close()
	e := Endpoint{Format: "openai", URL: srv.URL + "/v1", Key: "k1", Headers: map[string]string{"x-opencode-session": "s"}}
	ctx := context.Background()
	m, err := e.ListModels(ctx, ":free")
	if err != nil || strings.Join(m, ",") != "b:free,c:free" {
		t.Errorf("models %v %v", m, err)
	}
	if r, err := e.Chat(ctx, "a", "hola"); err != nil || r != "listo" {
		t.Errorf("chat %q %v", r, err)
	}
	bad := Endpoint{Format: "openai", URL: srv.URL + "/v1", Key: "k1"}
	_, err = bad.ListModels(ctx, "")
	if err == nil {
		t.Error("debe fallar sin cabecera")
	}
	bad.Key = "zzz"
	_, err = bad.ListModels(ctx, "")
	if err == nil || !strings.Contains(Explain(err, true, ""), "clave") {
		t.Errorf("401 debe explicarse: %v", err)
	}
}

func TestErrorsNeverLeakKey(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte("internal error with key SECRETKEY123 echoed"))
	}))
	defer srv.Close()
	_, err := Endpoint{Format: "openai", URL: srv.URL, Key: "SECRETKEY123"}.ListModels(context.Background(), "")
	if err == nil || strings.Contains(err.Error(), "SECRETKEY123") {
		t.Errorf("la clave no debe aparecer en errores: %v", err)
	}
}

func TestAnthropicFormat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "ak" || r.Header.Get("anthropic-version") == "" {
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case "/v1/models":
			w.Write([]byte(`{"data":[{"id":"claude-haiku-4-5"},{"id":"claude-opus-4"}]}`))
		case "/v1/messages":
			w.Write([]byte(`{"content":[{"type":"text","text":"listo"}]}`))
		}
	}))
	defer srv.Close()
	e := Endpoint{Format: "anthropic", URL: srv.URL, Key: "ak"}
	m, err := e.ListModels(context.Background(), "")
	if err != nil || len(m) != 2 || m[0] != "claude-haiku-4-5" {
		t.Errorf("models %v %v", m, err)
	}
	if r, err := e.Chat(context.Background(), "claude-haiku-4-5", "hola"); err != nil || r != "listo" {
		t.Errorf("chat %q %v", r, err)
	}
}

func TestGeminiFormat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-goog-api-key") != "gk" {
			w.WriteHeader(403)
			return
		}
		switch {
		case r.URL.Path == "/v1beta/models":
			w.Write([]byte(`{"models":[{"name":"models/gemini-2.5-flash","supportedGenerationMethods":["generateContent"]},{"name":"models/embedding-001","supportedGenerationMethods":["embedContent"]}]}`))
		case r.URL.Path == "/v1beta/models/gemini-2.5-flash:generateContent":
			w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"listo"}]}}]}`))
		default:
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()
	e := Endpoint{Format: "gemini", URL: srv.URL, Key: "gk"}
	m, err := e.ListModels(context.Background(), "")
	if err != nil || len(m) != 1 || m[0] != "gemini-2.5-flash" {
		t.Errorf("models %v %v", m, err)
	}
	if r, err := e.Chat(context.Background(), "gemini-2.5-flash", "hola"); err != nil || r != "listo" {
		t.Errorf("chat %q %v", r, err)
	}
}

func TestUVAsset(t *testing.T) {
	for _, c := range [][3]string{{"linux", "amd64", "uv-x86_64-unknown-linux-gnu.tar.gz"}, {"darwin", "arm64", "uv-aarch64-apple-darwin.tar.gz"}, {"windows", "amd64", "uv-x86_64-pc-windows-msvc.zip"}} {
		if a, err := UVAsset(c[0], c[1]); err != nil || a != c[2] {
			t.Errorf("%v -> %q %v", c, a, err)
		}
	}
}

func TestExplainProviderErrors(t *testing.T) {
	for _, c := range []struct {
		status int
		body   string
		want   string
	}{
		{401, `{"type":"error","error":{"type":"AuthError","message":"Invalid API key."}}`, "La clave no es válida: cópiala de nuevo desde https://k"},
		{400, `{"type":"error","error":{"type":"ModelError","message":"Model glm-4.6 is not supported"}}`, "Ese modelo no existe"},
		{401, `{"error":{"message":"Incorrect API key provided: SECRET","type":"invalid_request_error","code":"invalid_api_key"}}`, "La clave no es válida"},
		{404, `{"error":{"message":"The model gpt-x does not exist","type":"invalid_request_error","code":"model_not_found"}}`, "Ese modelo no existe"},
		{401, `{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`, "La clave no es válida"},
		{400, `{"error":{"code":400,"message":"API key not valid.","status":"INVALID_ARGUMENT"}}`, "La clave no es válida"},
		{404, `{"error":{"code":404,"message":"models/x is not found","status":"NOT_FOUND"}}`, "Ese modelo no existe"},
		{429, `{"error":{"message":"slow down","type":"rate_limit_error"}}`, "límite"},
		{500, `{"error":{"message":"boom","type":"server_error"}}`, "HTTP 500: boom"},
	} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(c.status)
			w.Write([]byte(c.body))
		}))
		_, err := Endpoint{Format: "openai", URL: srv.URL, Key: "SECRET"}.Chat(context.Background(), "m", "hola")
		srv.Close()
		got := Explain(err, true, "https://k")
		if !strings.Contains(got, c.want) || strings.Contains(got, "SECRET") {
			t.Errorf("%s -> %q (quería %q)", c.body, got, c.want)
		}
	}
	_, err := Endpoint{Format: "openai", URL: "http://127.0.0.1:1"}.Chat(context.Background(), "m", "hola")
	if got := Explain(err, true, ""); !strings.Contains(got, "Sin conexión") {
		t.Errorf("red: %q", got)
	}
}
