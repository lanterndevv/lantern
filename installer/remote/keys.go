// Package remote despliega Lantern en un servidor Linux por SSH.
package remote

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"os"
	"path/filepath"

	"golang.org/x/crypto/ssh"
)

// EnsureKey devuelve la clave privada (ruta) y la pública en formato authorized_keys.
// Si dir/lantern_ed25519 ya existe la reutiliza.
func EnsureKey(dir string) (privPath, authorized string, err error) {
	privPath = filepath.Join(dir, "lantern_ed25519")
	if b, e := os.ReadFile(privPath); e == nil {
		s, e := ssh.ParsePrivateKey(b)
		if e != nil {
			return "", "", e
		}
		return privPath, authorizedLine(s.PublicKey()), nil
	}
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return "", "", err
	}
	blk, err := ssh.MarshalPrivateKey(priv, "lantern")
	if err != nil {
		return "", "", err
	}
	if err = os.MkdirAll(dir, 0o700); err != nil {
		return "", "", err
	}
	if err = os.WriteFile(privPath, pem.EncodeToMemory(blk), 0o600); err != nil {
		return "", "", err
	}
	sp, err := ssh.NewPublicKey(pub)
	if err != nil {
		return "", "", err
	}
	line := authorizedLine(sp)
	return privPath, line, os.WriteFile(privPath+".pub", []byte(line+"\n"), 0o644)
}

func authorizedLine(k ssh.PublicKey) string {
	b := ssh.MarshalAuthorizedKey(k) // termina en \n
	return string(b[:len(b)-1]) + " lantern"
}
