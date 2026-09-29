package cloud

import (
	"context"
	"fmt"
	"os"

	"lantern/installer/model"
	"lantern/installer/remote"
)

// DeployVPS implementa model.Deployer para el modo "vps": crea el servidor y despliega por SSH.
// cfg.SSHKeyPath debe existir (remote.EnsureKey); su .pub se sube al proveedor.
// Si el despliegue falla el servidor NO se borra (se pierde dinero si se olvida, pero el usuario
// puede reintentar con cfg.SSHHost = la IP); la UI puede llamar a Delete.
func DeployVPS(ctx context.Context, c model.Config, log func(string)) (model.Result, error) {
	var p Provider
	switch c.CloudProvider {
	case "hetzner":
		p = &Hetzner{Token: c.CloudToken}
	case "digitalocean":
		p = &DigitalOcean{Token: c.CloudToken}
	default:
		return model.Result{}, fmt.Errorf("proveedor desconocido: %q", c.CloudProvider)
	}
	pub, err := os.ReadFile(c.SSHKeyPath + ".pub")
	if err != nil {
		return model.Result{}, err
	}
	s, err := p.Create(ctx, "lantern", string(pub), CloudInit(string(pub)), log)
	if err != nil {
		return model.Result{}, err
	}
	log("Servidor creado: " + s.IP)
	c.SSHHost, c.SSHUser = s.IP, "ubuntu"
	return remote.DeployModel(ctx, c, log)
}
