package ai

import (
	"context"
	"os"
	"os/exec"
	"testing"
)

// Descarga real de uv (unos 20 MB); solo con LANTERN_NET_TESTS=1.
func TestInstallUVReal(t *testing.T) {
	if os.Getenv("LANTERN_NET_TESTS") == "" {
		t.Skip("LANTERN_NET_TESTS no definido")
	}
	p, err := InstallUV(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command(p, "--version").CombinedOutput(); err != nil {
		t.Fatalf("%v %s", err, out)
	} else {
		t.Logf("%s", out)
	}
}
