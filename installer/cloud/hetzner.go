package cloud

import (
	"context"
	"fmt"
	"net/http"
	"time"
)

type Hetzner struct {
	Token    string
	Location string // "fsn1", "nbg1", "hel1", "ash"...; vacío = fsn1
	BaseURL  string // para tests; def. https://api.hetzner.cloud/v1
	HTTP     *http.Client
	Poll     time.Duration
}

func (h *Hetzner) init() {
	if h.BaseURL == "" {
		h.BaseURL = "https://api.hetzner.cloud/v1"
	}
	if h.HTTP == nil {
		h.HTTP = &http.Client{Timeout: 30 * time.Second}
	}
	if h.Location == "" {
		h.Location = "fsn1"
	}
	if h.Poll == 0 {
		h.Poll = 3 * time.Second
	}
}

// candidatos por precio aproximado (más barato primero); se elige el primero disponible en la ubicación.
var hetznerTypes = []string{"cax11", "cx22", "cpx11", "cx32"}

// PickType elige el tipo más barato de la lista cuyo datacenter de la ubicación lo soporte.
func (h *Hetzner) PickType(ctx context.Context) (string, error) {
	h.init()
	var dcs struct {
		Datacenters []struct {
			Location    struct{ Name string } `json:"location"`
			ServerTypes struct {
				Available []int64 `json:"available"`
			} `json:"server_types"`
		} `json:"datacenters"`
	}
	if err := doJSON(ctx, h.HTTP, "GET", h.BaseURL+"/datacenters", h.Token, nil, &dcs); err != nil {
		return "", err
	}
	avail := map[int64]bool{}
	for _, d := range dcs.Datacenters {
		if d.Location.Name == h.Location {
			for _, id := range d.ServerTypes.Available {
				avail[id] = true
			}
		}
	}
	var types struct {
		ServerTypes []struct {
			ID   int64
			Name string
		} `json:"server_types"`
	}
	if err := doJSON(ctx, h.HTTP, "GET", h.BaseURL+"/server_types?per_page=50", h.Token, nil, &types); err != nil {
		return "", err
	}
	ids := map[string]int64{}
	for _, t := range types.ServerTypes {
		ids[t.Name] = t.ID
	}
	for _, n := range hetznerTypes { // orden = prioridad de precio
		if id, ok := ids[n]; ok && avail[id] {
			return n, nil
		}
	}
	return "", fmt.Errorf("Hetzner: ningún tipo %v disponible en %s", hetznerTypes, h.Location)
}

func (h *Hetzner) Create(ctx context.Context, name, pub, userData string, log func(string)) (Server, error) {
	h.init()
	typ, err := h.PickType(ctx)
	if err != nil {
		return Server{}, err
	}
	log("Hetzner: tipo " + typ + " en " + h.Location)
	var k struct {
		SSHKey struct{ ID int64 } `json:"ssh_key"`
	}
	if err := doJSON(ctx, h.HTTP, "POST", h.BaseURL+"/ssh_keys", h.Token, map[string]any{"name": name + "-" + itoa(time.Now().Unix()), "public_key": pub}, &k); err != nil {
		return Server{}, err
	}
	var s struct {
		Server struct {
			ID        int64
			PublicNet struct {
				IPv4 struct{ IP string } `json:"ipv4"`
			} `json:"public_net"`
		} `json:"server"`
	}
	err = doJSON(ctx, h.HTTP, "POST", h.BaseURL+"/servers", h.Token, map[string]any{
		"name": name, "server_type": typ, "image": "ubuntu-24.04", "location": h.Location,
		"ssh_keys": []int64{k.SSHKey.ID}, "user_data": userData, "start_after_create": true,
	}, &s)
	if err != nil {
		return Server{}, err
	}
	srv := Server{ID: s.Server.ID, IP: s.Server.PublicNet.IPv4.IP, Name: name}
	err = poll(ctx, h.Poll, 100, func() (bool, error) {
		var g struct {
			Server struct {
				Status    string
				PublicNet struct {
					IPv4 struct{ IP string } `json:"ipv4"`
				} `json:"public_net"`
			}
		}
		if err := doJSON(ctx, h.HTTP, "GET", h.BaseURL+"/servers/"+itoa(srv.ID), h.Token, nil, &g); err != nil {
			return false, err
		}
		srv.IP = g.Server.PublicNet.IPv4.IP
		return g.Server.Status == "running" && srv.IP != "", nil
	})
	return srv, err
}

func (h *Hetzner) Delete(ctx context.Context, id int64) error {
	h.init()
	return doJSON(ctx, h.HTTP, "DELETE", h.BaseURL+"/servers/"+itoa(id), h.Token, nil, nil)
}
