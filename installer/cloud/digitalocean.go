package cloud

import (
	"context"
	"net/http"
	"time"
)

type DigitalOcean struct {
	Token   string
	Region  string // vacío = fra1
	BaseURL string // tests; def. https://api.digitalocean.com/v2
	HTTP    *http.Client
	Poll    time.Duration
}

func (d *DigitalOcean) init() {
	if d.BaseURL == "" {
		d.BaseURL = "https://api.digitalocean.com/v2"
	}
	if d.HTTP == nil {
		d.HTTP = &http.Client{Timeout: 30 * time.Second}
	}
	if d.Region == "" {
		d.Region = "fra1"
	}
	if d.Poll == 0 {
		d.Poll = 3 * time.Second
	}
}

func (d *DigitalOcean) Create(ctx context.Context, name, pub, userData string, log func(string)) (Server, error) {
	d.init()
	var k struct {
		SSHKey struct{ ID int64 } `json:"ssh_key"`
	}
	if err := doJSON(ctx, d.HTTP, "POST", d.BaseURL+"/account/keys", d.Token, map[string]any{"name": name + "-" + itoa(time.Now().Unix()), "public_key": pub}, &k); err != nil {
		return Server{}, err
	}
	var r struct {
		Droplet struct{ ID int64 }
	}
	err := doJSON(ctx, d.HTTP, "POST", d.BaseURL+"/droplets", d.Token, map[string]any{
		"name": name, "region": d.Region, "size": "s-1vcpu-1gb", "image": "ubuntu-24-04-x64",
		"ssh_keys": []int64{k.SSHKey.ID}, "user_data": userData,
	}, &r)
	if err != nil {
		return Server{}, err
	}
	log("DigitalOcean: droplet creado, esperando IP")
	srv := Server{ID: r.Droplet.ID, Name: name}
	err = poll(ctx, d.Poll, 100, func() (bool, error) {
		var g struct {
			Droplet struct {
				Status   string
				Networks struct {
					V4 []struct {
						IPAddress string `json:"ip_address"`
						Type      string `json:"type"`
					} `json:"v4"`
				}
			}
		}
		if err := doJSON(ctx, d.HTTP, "GET", d.BaseURL+"/droplets/"+itoa(srv.ID), d.Token, nil, &g); err != nil {
			return false, err
		}
		for _, n := range g.Droplet.Networks.V4 {
			if n.Type == "public" {
				srv.IP = n.IPAddress
			}
		}
		return g.Droplet.Status == "active" && srv.IP != "", nil
	})
	return srv, err
}

func (d *DigitalOcean) Delete(ctx context.Context, id int64) error {
	d.init()
	return doJSON(ctx, d.HTTP, "DELETE", d.BaseURL+"/droplets/"+itoa(id), d.Token, nil, nil)
}
