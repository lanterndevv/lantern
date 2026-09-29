package docker

import (
	"strings"
	"testing"
)

func TestCompose(t *testing.T) {
	c := Compose(Options{})
	for _, w := range []string{"build: ..", "env_file: lantern.env", "./data:/data", "8787:8787", "restart: unless-stopped"} {
		if !strings.Contains(c, w) {
			t.Errorf("falta %q\n%s", w, c)
		}
	}
	c = Compose(Options{Image: "ghcr.io/x/lantern:1", Port: 9000})
	if !strings.Contains(c, "image: ghcr.io/x/lantern:1") || strings.Contains(c, "build:") || !strings.Contains(c, "9000:9000") {
		t.Fatal(c)
	}
	if !strings.Contains(NASInstructions("es"), "Synology") || !strings.Contains(NASInstructions("en"), "Unraid") {
		t.Fatal("nas")
	}
}
