# remote / cloud / docker

Uso (adaptador trivial hacia `Deployer` en modes.go):

```go
key, pub, _ := remote.EnsureKey(dataDir)           // pub: línea authorized_keys para Oracle/Hetzner/DO
res, err := remote.Deploy(ctx, remote.Config{
    Host: ip, User: "ubuntu", KeyPath: key, KnownHostsPath: filepath.Join(dataDir, "known_hosts"),
    ReleasesURL: rel, Version: ver, Domain: "" /* => <ip>.sslip.io */, LiveKit: false, Laya: false,
    DMName: "DM", ExtraEnv: map[string]string{"LANTERN_LLM_URL": "..."},
}, log)
// res.InviteURL, res.DMURL (lleva la clave en #k=, no se escribe en el log), res.PortsOpen
```
- `Deploy` reintenta SSH (RetryEvery/ConnectTimeout) mientras arranca la VM, aplica TOFU (aviso la 1ª vez, error `ErrHostKeyChanged` si cambia),
  sube `install.sh` + Caddyfile (+ extra env), lo ejecuta con `sudo -n` y vuelca cada línea a `log`.
  Si `PortsOpen` es false, muestra `cloud.OracleGuide(lang, pub)` (paso 4: Security List).
- VPS: `cloud.Hetzner{Token,Location}` / `cloud.DigitalOcean{Token,Region}` -> `Create(ctx, name, pub, cloud.CloudInit(pub), log)` devuelve IP; luego `remote.Deploy` con User "ubuntu".
  `Delete(ctx, id)` borra. Info de precios y pasos del token: `cloud.HetznerInfo`, `cloud.DigitalOceanInfo`.
- Oracle: sólo guía manual (`cloud.OracleGuide`); crear la instancia por API de OCI queda fuera.
- NAS/local: `docker.Compose(docker.Options{...})`, `docker.NASInstructions(lang)`.
- Pruebas del script en contenedor: `SKIP_SYSTEMD=1` omite systemd/Caddy/cortafuegos.
