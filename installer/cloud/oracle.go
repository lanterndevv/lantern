package cloud

import (
	"context"
	"errors"
	"net"
	"sync"
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

// GuideStep es un paso de la guía de Oracle: una sola tarea por pantalla.
// Body son párrafos separados por \n; las líneas que empiezan por «• » son viñetas.
type GuideStep struct {
	Title, Body string
	URL         string // página que abre la tecla «o» ("" = ninguna)
}

// Índices de los pasos que la interfaz completa (clave pública y campo de IP).
const (
	OracleKeyStep = 1
	OracleIPStep  = 4
)

// OracleSteps devuelve la guía (lang "es" o "en"). Los nombres de la consola van entre comillas y en inglés, tal como salen en pantalla.
func OracleSteps(lang string) []GuideStep {
	if lang == "en" {
		return []GuideStep{
			{"Create your Oracle Cloud account", "Oracle gives away a small always-on computer (a \"server\") for free, forever: this is called \"Always Free\". Lantern will live there so you can play without leaving your PC on.\nThey ask for a credit card only to check you are a real person. It is not charged.\nPick a region close to you: it cannot be changed later.\nPress \"o\" to open the sign-up page, finish it, and come back here.", OracleSignupURL},
			{"Copy your access key", "So I can log into your server and set it up, Oracle needs a \"public key\". I already made one for you. It is not a password and you do not need to save it.\nPress \"c\" to copy it. You will paste it in the next step.", ""},
			{"Create the machine", "Press \"o\" to open \"Compute\" > \"Instances\" and click \"Create instance\". Then:\n• \"Image and shape\" > \"Change image\": pick \"Canonical Ubuntu 24.04\".\n• \"Change shape\" > \"Ampere\": pick \"VM.Standard.A1.Flex\" with 2 OCPU and 12 GB of memory (tagged \"Always Free-eligible\").\n• \"Networking\": keep the defaults and check \"Automatically assign public IPv4 address\" is on.\n• \"Add SSH keys\": choose \"Paste public keys\" and paste the key (\"c\" copies it again).\n• Click \"Create\" and wait until it says \"Running\" in green.\nIf you see \"Out of capacity\", Oracle has no room right now: try another \"Availability domain\" or retry in a while.", OracleInstancesURL},
			{"Open the doors to the web", "By default Oracle blocks all Internet traffic to your machine. Your players' browsers need to get in. Press \"o\" to open \"Virtual cloud networks\", then:\n• Click your network, then \"Security\" > \"Default Security List\" > \"Add Ingress Rules\".\n• \"Source CIDR\": 0.0.0.0/0. \"IP Protocol\": TCP. \"Destination Port Range\": 80,443. Click \"Add Ingress Rules\".\n• For voice, add two more rules: TCP 7881 and UDP 7882 (optional).", OracleVCNsURL},
			{"Type the machine's IP", "In the instance page, find \"Public IP address\" (not \"Private IP\"): four numbers separated by dots. Type it below. I will check that I can reach the machine before going on.", ""},
		}
	}
	return []GuideStep{
		{"Crea tu cuenta de Oracle Cloud", "Oracle regala un pequeño ordenador siempre encendido (un «servidor») gratis y para siempre: se llama «Always Free». Ahí vivirá Lantern, para que puedas jugar sin dejar tu PC encendido.\nTe piden una tarjeta solo para comprobar que eres una persona real. No se cobra nada.\nElige una región cercana a ti: luego no se puede cambiar.\nPulsa «o» para abrir la página de registro, complétala y vuelve aquí.", OracleSignupURL},
		{"Copia tu clave de acceso", "Para que yo pueda entrar en tu servidor y dejarlo listo, Oracle necesita una «clave pública». Ya te he creado una. No es una contraseña y no tienes que guardarla.\nPulsa «c» para copiarla. La pegarás en el paso siguiente.", ""},
		{"Crea la máquina", "Pulsa «o» para abrir «Compute» > «Instances» y haz clic en «Create instance». Después:\n• «Image and shape» > «Change image»: elige «Canonical Ubuntu 24.04».\n• «Change shape» > «Ampere»: elige «VM.Standard.A1.Flex» con 2 OCPU y 12 GB de memoria (lleva la etiqueta «Always Free-eligible»).\n• «Networking»: deja lo que viene y comprueba que «Automatically assign public IPv4 address» está activado.\n• «Add SSH keys»: elige «Paste public keys» y pega la clave («c» te la vuelve a copiar).\n• Pulsa «Create» y espera a que ponga «Running» en verde.\nSi sale «Out of capacity», Oracle no tiene hueco ahora: prueba otro «Availability domain» o reintenta más tarde.", OracleInstancesURL},
		{"Abre las puertas a la web", "Por defecto Oracle bloquea todo el tráfico de Internet hacia tu máquina, y los navegadores de tus jugadores tienen que poder entrar. Pulsa «o» para abrir «Virtual cloud networks» y:\n• Entra en tu red, luego «Security» > «Default Security List» > «Add Ingress Rules».\n• «Source CIDR»: 0.0.0.0/0. «IP Protocol»: TCP. «Destination Port Range»: 80,443. Pulsa «Add Ingress Rules».\n• Para la voz, añade dos reglas más: TCP 7881 y UDP 7882 (opcional).", OracleVCNsURL},
		{"Escribe la IP de la máquina", "En la página de la instancia busca «Public IP address» (no «Private IP»): son cuatro números separados por puntos. Escríbela abajo. Antes de seguir comprobaré que puedo llegar a la máquina.", ""},
	}
}

// Reach dice cómo responde host:port: "open" (acepta), "closed" (la red deja pasar pero nadie escucha)
// o "filtered" (no hay respuesta: un cortafuegos como la Security List de Oracle lo descarta, o la IP no existe).
func Reach(ctx context.Context, host, port string) string {
	cctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	var d net.Dialer
	c, err := d.DialContext(cctx, "tcp", net.JoinHostPort(host, port))
	if err == nil {
		c.Close()
		return "open"
	}
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return "filtered"
	}
	return "closed"
}

// CheckOracle comprueba en paralelo el SSH (22) y las puertas web (80 y 443) de la máquina recién creada.
// Los puertos web aún no tienen nada escuchando: "closed" es correcto, solo "filtered" es un fallo.
// ponytail: un REJECT del iptables de la máquina cuenta como "closed"; solo se detecta el descarte silencioso (Security List). remote.Deploy comprueba 80/443 al final.
func CheckOracle(ctx context.Context, host string) (ssh string, webBlocked bool) {
	var wg sync.WaitGroup
	res := make([]string, 3)
	for i, p := range []string{"22", "80", "443"} {
		wg.Add(1)
		go func() { defer wg.Done(); res[i] = Reach(ctx, host, p) }()
	}
	wg.Wait()
	return res[0], res[1] == "filtered" || res[2] == "filtered"
}
