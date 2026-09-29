package cloud

import "strings"

// CloudInit prepara el servidor para que el instalador entre por SSH como "root" o "ubuntu":
// no instala Lantern (lo hace remote.Deploy por SSH, con logs en streaming). Sólo garantiza que
// el usuario ubuntu exista con sudo sin contraseña y la clave autorizada, y que se espere a apt.
// ponytail: Lantern lo instala remote.Deploy y no cloud-init, para ver el progreso y reintentar;
// si quieres "fire and forget", pasa aquí install.sh en un write_files y runcmd.
func CloudInit(pubKey string) string {
	return `#cloud-config
package_update: false
users:
  - default
  - name: ubuntu
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - ` + strings.TrimSpace(pubKey) + `
`
}
