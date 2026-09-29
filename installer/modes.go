package main

import (
	"lantern/installer/cloud"
	"lantern/installer/model"
	"lantern/installer/remote"
)

// Deployer y compañía viven en model para que remote/ y cloud/ puedan importarlos.
type (
	Config   = model.Config
	Result   = model.Result
	Deployer = model.Deployer
)

// deployers por modo de alojamiento remoto. "local" y "lan" los ejecuta engine.Run (o Docker, en la UI).
var deployers = map[string]Deployer{
	"oracle": model.DeployFunc(remote.DeployModel),
	"vps":    model.DeployFunc(cloud.DeployVPS),
}
