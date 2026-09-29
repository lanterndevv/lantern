//go:build !windows

package platform

import (
	"os"
	"path/filepath"
	"syscall"
)

// FreeDisk devuelve los bytes libres en el volumen de dir (o del padre existente).
func FreeDisk(dir string) uint64 {
	for {
		if _, err := os.Stat(dir); err == nil || filepath.Dir(dir) == dir {
			break
		}
		dir = filepath.Dir(dir)
	}
	var s syscall.Statfs_t
	if syscall.Statfs(dir, &s) != nil {
		return 0
	}
	return uint64(s.Bavail) * uint64(s.Bsize)
}
