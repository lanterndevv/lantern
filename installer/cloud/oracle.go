package cloud

import (
	"context"
	"net"
	"time"
)

// Oracle: la creación por API de OCI queda fuera (exige firmar peticiones con claves de tenancy y OCIDs);
// se guía la alta manual y se comprueba después la conectividad (ver remote.Deploy / CheckSSH).

const (
	OracleSignupURL    = "https://signup.cloud.oracle.com/"
	OracleConsoleURL   = "https://cloud.oracle.com/"
	OracleInstancesURL = "https://cloud.oracle.com/compute/instances"
	OracleVCNsURL      = "https://cloud.oracle.com/networking/vcns"
)

// OracleGuide devuelve los pasos (lang "es" o "en"); pubKey se muestra para pegarla.
func OracleGuide(lang, pubKey string) string {
	if lang == "en" {
		return `Oracle Cloud Always Free (Ampere A1: 2 OCPU / 12 GB)
1. Sign up (credit card required for verification, not charged): ` + OracleSignupURL + `
2. Console > Compute > Instances > Create instance: ` + OracleInstancesURL + `
   - Image: Canonical Ubuntu 24.04 (aarch64).
   - Shape: Ampere VM.Standard.A1.Flex, 2 OCPU, 12 GB ("Always Free-eligible").
   - Networking: keep the default VCN and a public IPv4 address.
   - Add SSH keys > Paste public keys, and paste this line:
     ` + pubKey + `
3. If it says "Out of capacity", try another availability domain or retry later.
4. Open ports 80 and 443: ` + OracleVCNsURL + ` > your VCN > Security > Default Security List >
   Add Ingress Rules: Source CIDR 0.0.0.0/0, protocol TCP, destination ports 80,443
   (for voice also TCP 7881 and UDP 7882).
5. Copy the instance's public IP and enter it here (SSH user: ubuntu).`
	}
	return `Oracle Cloud Always Free (Ampere A1: 2 OCPU / 12 GB)
1. Regístrate (pide tarjeta para verificar, no se cobra): ` + OracleSignupURL + `
2. Consola > Compute > Instances > Create instance: ` + OracleInstancesURL + `
   - Imagen: Canonical Ubuntu 24.04 (aarch64).
   - Shape: Ampere VM.Standard.A1.Flex, 2 OCPU, 12 GB ("Always Free-eligible").
   - Red: deja la VCN por defecto y una IPv4 pública.
   - Add SSH keys > Paste public keys, y pega esta línea:
     ` + pubKey + `
3. Si dice "Out of capacity", prueba otro dominio de disponibilidad o reintenta más tarde.
4. Abre los puertos 80 y 443: ` + OracleVCNsURL + ` > tu VCN > Security > Default Security List >
   Add Ingress Rules: Source CIDR 0.0.0.0/0, protocolo TCP, puertos de destino 80,443
   (para voz, también TCP 7881 y UDP 7882).
5. Copia la IP pública de la instancia e introdúcela aquí (usuario SSH: ubuntu).`
}

// CheckConnectivity dice qué puertos TCP de host no abren desde este equipo (vacío = todos bien).
func CheckConnectivity(ctx context.Context, host string, ports ...string) []string {
	var bad []string
	var d net.Dialer
	for _, p := range ports {
		cctx, cancel := context.WithTimeout(ctx, 6*time.Second)
		c, err := d.DialContext(cctx, "tcp", net.JoinHostPort(host, p))
		cancel()
		if err != nil {
			bad = append(bad, p)
			continue
		}
		c.Close()
	}
	return bad
}
