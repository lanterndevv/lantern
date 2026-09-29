// Package docker genera el docker-compose.yml de Lantern para un NAS o servidor propio.
package docker

import "fmt"

type Options struct {
	Image string // imagen publicada; vacío => build desde el Dockerfile del repo
	Build string // contexto del build (def. "..", el repo si el compose está en installer/)
	Port  int    // def. 8787
	Env   string // env_file (def. lantern.env)
	Data  string // volumen (def. ./data)
}

// Compose devuelve el docker-compose.yml. El Dockerfile del repo ya fija HOST=0.0.0.0, LANTERN_DB=/data/lantern.db.
func Compose(o Options) string {
	if o.Port == 0 {
		o.Port = 8787
	}
	if o.Env == "" {
		o.Env = "lantern.env"
	}
	if o.Data == "" {
		o.Data = "./data"
	}
	src := "    image: " + o.Image + "\n"
	if o.Image == "" {
		if o.Build == "" {
			o.Build = ".."
		}
		src = "    build: " + o.Build + "\n    image: lantern:local\n"
	}
	return fmt.Sprintf(`services:
  lantern:
%s    restart: unless-stopped
    env_file: %s
    environment:
      PORT: "%d"
    ports:
      - "%d:%d"
    volumes:
      - %s:/data
`, src, o.Env, o.Port, o.Port, o.Port, o.Data)
}

// NASInstructions: texto corto (lang "es"/"en").
func NASInstructions(lang string) string {
	if lang == "en" {
		return `NAS with Docker
- Synology (Container Manager): Project > Create > paste docker-compose.yml and lantern.env in one shared folder > Build.
- Unraid: install the "Docker Compose Manager" plugin (Community Apps), add a stack, paste the compose file.
- TrueNAS SCALE: Apps > Discover Apps > Install via YAML, paste the compose file (set data to a dataset path).
- Open http://<NAS-IP>:8787. Microphone/voice need HTTPS: put a reverse proxy (Synology "Reverse Proxy", Nginx Proxy Manager) or a Cloudflare tunnel in front.
- Back up the data folder (lantern.db + assets).`
	}
	return `NAS con Docker
- Synology (Container Manager): Proyecto > Crear > pega docker-compose.yml y lantern.env en una carpeta compartida > Compilar.
- Unraid: instala el plugin "Docker Compose Manager" (Community Apps), añade una pila y pega el compose.
- TrueNAS SCALE: Apps > Discover Apps > Install via YAML, pega el compose (pon data en la ruta de un dataset).
- Abre http://<IP-del-NAS>:8787. El micrófono/voz necesitan HTTPS: pon delante un proxy inverso (el de Synology, Nginx Proxy Manager) o un túnel de Cloudflare.
- Haz copia de la carpeta de datos (lantern.db + assets).`
}
