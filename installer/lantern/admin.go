package lantern

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// Admin es el cliente de /admin/* (solo 127.0.0.1, con token).
type Admin struct {
	Base  string // p. ej. http://127.0.0.1:8787
	Token string
	HTTP  *http.Client
}

type Status struct {
	Version string `json:"version"`
	Rooms   int    `json:"rooms"`
	LLM     bool   `json:"llm"`
	Laya    string `json:"laya"`
	Origin  string `json:"origin"`
}

type Table struct {
	Code      string `json:"code"`
	InviteURL string `json:"inviteUrl"`
	DMURL     string `json:"dmUrl"`
}

func (a *Admin) do(ctx context.Context, method, path string, body io.Reader, ctype string, out any) error {
	c := a.HTTP
	if c == nil {
		c = &http.Client{Timeout: 5 * time.Minute}
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(a.Base, "/")+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("authorization", "Bearer "+a.Token)
	if ctype != "" {
		req.Header.Set("content-type", ctype)
	}
	resp, err := c.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("%s %s: HTTP %d %s", method, path, resp.StatusCode, strings.TrimSpace(string(b)))
	}
	if out != nil {
		return json.Unmarshal(b, out)
	}
	return nil
}

func (a *Admin) Status(ctx context.Context) (s Status, err error) {
	err = a.do(ctx, "GET", "/admin/status", nil, "", &s)
	return
}

func (a *Admin) Bootstrap(ctx context.Context, dmName, title string) (t Table, err error) {
	b, _ := json.Marshal(map[string]string{"dmName": dmName, "title": title})
	err = a.do(ctx, "POST", "/admin/bootstrap", bytes.NewReader(b), "application/json", &t)
	return
}

// Import sube un .zip de Lantern (kind=lantern) o .dd2vtt/.uvtt (kind=uvtt) a la mesa code.
func (a *Admin) Import(ctx context.Context, code, path string) (summary string, err error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	kind := "uvtt"
	if strings.HasSuffix(strings.ToLower(path), ".zip") {
		kind = "lantern"
	}
	var r struct {
		OK      bool `json:"ok"`
		Summary any  `json:"summary"`
	}
	err = a.do(ctx, "POST", "/admin/import?code="+url.QueryEscape(code)+"&kind="+kind, f, "application/octet-stream", &r)
	if err == nil {
		s, _ := json.Marshal(r.Summary)
		summary = string(s)
	}
	return
}

// WaitHealth espera a que /health responda ok.
func WaitHealth(ctx context.Context, base string, timeout time.Duration) error {
	dl := time.Now().Add(timeout)
	for {
		req, _ := http.NewRequestWithContext(ctx, "GET", strings.TrimRight(base, "/")+"/health", nil)
		if resp, err := http.DefaultClient.Do(req); err == nil {
			b, _ := io.ReadAll(io.LimitReader(resp.Body, 64))
			resp.Body.Close()
			if resp.StatusCode == 200 && strings.TrimSpace(string(b)) == "ok" {
				return nil
			}
		}
		if time.Now().After(dl) || ctx.Err() != nil {
			return fmt.Errorf("el servidor no respondió en /health a tiempo (%s)", base)
		}
		time.Sleep(300 * time.Millisecond)
	}
}
