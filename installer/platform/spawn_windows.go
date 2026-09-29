//go:build windows

package platform

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
)

func alive(pid int) bool {
	if pid <= 0 {
		return false
	}
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	p.Release()
	return exec.Command("tasklist", "/FI", "PID eq "+strconv.Itoa(pid)).Run() == nil
}

func (m Manager) spawn(s Svc) error {
	_ = m.Stop(s)
	_ = os.MkdirAll(filepath.Dir(s.Pid), 0o755)
	lf, err := os.OpenFile(s.Log, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer lf.Close()
	c := exec.Command(s.Exec, s.Args...)
	c.Dir = s.Dir
	c.Env = os.Environ()
	for k, v := range s.Env {
		c.Env = append(c.Env, k+"="+v)
	}
	c.Stdout, c.Stderr = lf, lf
	c.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000 | 0x00000200} // NO_WINDOW | NEW_PROCESS_GROUP
	if err := c.Start(); err != nil {
		return err
	}
	pid := c.Process.Pid
	go c.Wait()
	return os.WriteFile(s.Pid, []byte(strconv.Itoa(pid)), 0o644)
}
