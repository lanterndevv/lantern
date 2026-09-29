package cloud

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHetzner(t *testing.T) {
	polls := 0
	var created map[string]any
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			w.WriteHeader(401)
			return
		}
		switch r.Method + " " + r.URL.Path {
		case "GET /datacenters": // cax11 (id 45) no disponible en fsn1; cx22 (id 22) sí
			io.WriteString(w, `{"datacenters":[{"location":{"name":"nbg1"},"server_types":{"available":[45,22]}},{"location":{"name":"fsn1"},"server_types":{"available":[22,23]}}]}`)
		case "GET /server_types":
			io.WriteString(w, `{"server_types":[{"id":45,"name":"cax11"},{"id":22,"name":"cx22"},{"id":23,"name":"cx32"}]}`)
		case "POST /ssh_keys":
			io.WriteString(w, `{"ssh_key":{"id":7}}`)
		case "POST /servers":
			json.NewDecoder(r.Body).Decode(&created)
			io.WriteString(w, `{"server":{"id":99,"public_net":{"ipv4":{"ip":""}}}}`)
		case "GET /servers/99":
			polls++
			st, ip := "initializing", ""
			if polls > 1 {
				st, ip = "running", "203.0.113.5"
			}
			io.WriteString(w, `{"server":{"status":"`+st+`","public_net":{"ipv4":{"ip":"`+ip+`"}}}}`)
		case "DELETE /servers/99":
			io.WriteString(w, `{}`)
		default:
			w.WriteHeader(404)
		}
	}))
	defer ts.Close()
	h := &Hetzner{Token: "tok", BaseURL: ts.URL, Poll: time.Millisecond}
	s, err := h.Create(context.Background(), "lantern", "ssh-ed25519 AAA", CloudInit("ssh-ed25519 AAA"), func(string) {})
	if err != nil || s.IP != "203.0.113.5" || s.ID != 99 {
		t.Fatalf("%+v %v", s, err)
	}
	if created["server_type"] != "cx22" || created["image"] != "ubuntu-24.04" || !strings.Contains(created["user_data"].(string), "#cloud-config") {
		t.Fatalf("payload %v", created)
	}
	if err := h.Delete(context.Background(), 99); err != nil {
		t.Fatal(err)
	}
	if _, err := (&Hetzner{Token: "mal", BaseURL: ts.URL}).PickType(context.Background()); err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("esperaba 401: %v", err)
	}
}

func TestDigitalOcean(t *testing.T) {
	polls := 0
	var created map[string]any
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "POST /account/keys":
			io.WriteString(w, `{"ssh_key":{"id":5}}`)
		case "POST /droplets":
			json.NewDecoder(r.Body).Decode(&created)
			io.WriteString(w, `{"droplet":{"id":42}}`)
		case "GET /droplets/42":
			polls++
			if polls < 2 {
				io.WriteString(w, `{"droplet":{"status":"new","networks":{"v4":[]}}}`)
				return
			}
			io.WriteString(w, `{"droplet":{"status":"active","networks":{"v4":[{"ip_address":"10.0.0.2","type":"private"},{"ip_address":"198.51.100.7","type":"public"}]}}}`)
		case "DELETE /droplets/42":
			w.WriteHeader(204)
		default:
			w.WriteHeader(404)
		}
	}))
	defer ts.Close()
	d := &DigitalOcean{Token: "t", BaseURL: ts.URL, Poll: time.Millisecond}
	s, err := d.Create(context.Background(), "lantern", "ssh-ed25519 AAA", "#cloud-config", func(string) {})
	if err != nil || s.IP != "198.51.100.7" {
		t.Fatalf("%+v %v", s, err)
	}
	if created["size"] != "s-1vcpu-1gb" {
		t.Fatalf("%v", created)
	}
	if err := d.Delete(context.Background(), 42); err != nil {
		t.Fatal(err)
	}
}

func TestOracleSteps(t *testing.T) {
	for _, l := range []string{"es", "en"} {
		g := OracleSteps(l)
		if len(g) != OracleIPStep+1 || g[0].URL != OracleSignupURL || !strings.Contains(g[3].Body, "443") {
			t.Fatal(l)
		}
	}
	if Reach(context.Background(), "127.0.0.1", "1") != "closed" {
		t.Fatal("puerto 1 debería rechazar la conexión")
	}
}
