<p align="center"><img src="docs/img/banner.svg" alt="Lantern" width="100%"></p>

<p align="center"><b>The D&amp;D 5e virtual tabletop you install with a single command.</b><br>
Tactical map with light and fog, fast combat, your D&amp;D Beyond characters, and a table ready to share with your players through a link.</p>

<p align="center">
  <a href="LICENSE"><img alt="AGPL-3.0 license" src="https://img.shields.io/badge/license-AGPL--3.0-8a6d1f"></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platforms-Linux%20%C2%B7%20macOS%20%C2%B7%20Windows-14100c">
  <img alt="Rules" src="https://img.shields.io/badge/rules-5e%202014%20%2B%202024-8a6d1f">
  <img alt="Languages" src="https://img.shields.io/badge/languages-ES%20%C2%B7%20EN-14100c">
  <img alt="Status" src="https://img.shields.io/badge/status-preview-b5651d">
</p>

<p align="center"><a href="README.md">🇪🇸 Español</a> · 🇬🇧 English</p>

> The guides in `docs/` are written in Spanish for now.

## Install with one command

Open a terminal, paste the command for your system and follow the wizard. You do not need Node, Docker or anything else.

**Linux and macOS**

```sh
curl -fsSL https://raw.githubusercontent.com/lanterndevv/lantern/master/install.sh | sh
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/lanterndevv/lantern/master/install.ps1 | iex
```

The script downloads the wizard from the [GitHub releases](https://github.com/lanterndevv/lantern/releases), verifies its SHA-256 and opens it. Everything needed lives on GitHub: there is no intermediate server. Step-by-step guide for non-technical users: [docs/guia-instalacion.md](docs/guia-instalacion.md) (Spanish).

## What the wizard does

One question per screen, sensible defaults, keyboard or mouse, ES/EN:

1. **Where to play:** your own computer with a public link (Cloudflare tunnel), a free Oracle Cloud machine, a cheap VPS created through its API, or local network / NAS with Docker.
2. **Name and HTTPS** (Caddy with automatic certificates on remote servers).
3. **Artificial intelligence** (optional): local Laya for monster turns and an LLM provider of your choice (free options exist).
4. **Voice** for large tables (LiveKit, optional).
5. **Your table:** your DM name, the title, and importing a Lantern campaign or a `.dd2vtt`/`.uvtt` map.
6. **Done:** invitation link with code and QR, and Lantern starts on boot. Running `lantern` again opens a dashboard with status, link, logs, update and uninstall.

## Screenshots

<!-- TODO: add real screenshots in docs/img/ (no invented images). Suggested: asistente.png, mesa.png, combate.png, movil.png -->

| Wizard | Table | Combat | Mobile |
|---|---|---|---|
| *TODO: `docs/img/asistente.png`* | *TODO: `docs/img/mesa.png`* | *TODO: `docs/img/combate.png`* | *TODO: `docs/img/movil.png`* |

## Main features

- **Dynamic light and fog** by raycasting: walls, doors, lights and each token's vision (darkness, darkvision, cover), with a calibratable grid and Dungeondraft maps (`.dd2vtt`/`.uvtt`).
- **5e 2014 and 2024 rules engine** with SRD 5.2.1 content: rolls, saves, conditions, spells, monsters and a character creator.
- **Lantern Link:** browser extension that brings your D&D Beyond characters (and, as DM, monster stat blocks) into Lantern. Works with Beyond20 rolls. See [docs/lantern-link.md](docs/lantern-link.md).
- **Two-click combat:** initiative, turns, reactions, legendary actions, typed damage and conditions.
- **Atmosphere:** Story mode, per-zone weather, music and ambience with transitions, and voice chat.
- **Play anywhere:** laptop, phone, tablet, physical tabletop display and streaming mode.
- **Optional copilot** (local Laya and any LLM): it suggests, never acts on its own; the DM confirms. Lantern works the same without AI.
- **Spanish and English** across the interface. Campaigns export in an [open format](apps/server/FORMAT.md).

DM quickstart: [docs/guia-dm.md](docs/guia-dm.md) (Spanish).

## For those who want more

- **Docker, VPS, LAN, HTTPS, LiveKit and AI:** [docs/autoalojamiento.md](docs/autoalojamiento.md).
- **Development, building from source, publishing a release:** [CONTRIBUTING.md](CONTRIBUTING.md).
- **Beyond20:** [docs/beyond20.md](docs/beyond20.md) · **Campaign format:** [apps/server/FORMAT.md](apps/server/FORMAT.md).

Quick start with Docker:

```sh
docker run -v lantern:/data -p 8787:8787 ghcr.io/lanterndevv/lantern
```

## Project status

Lantern is a **preview release**. Keep in mind:

- macOS binaries are ad hoc signed and Windows binaries are unsigned: Gatekeeper and SmartScreen will warn the first time (the guide explains how to continue). It has only been tested thoroughly on Linux.
- The dice relay to the D&D Beyond Game Log is implemented but **has not been tested against real D&D Beyond**, and it goes against their terms of service (it is optional and off by default).
- The server does not encrypt by itself: on the Internet, use the wizard's tunnel or a proxy with HTTPS.
- Back up your campaigns (export to `.zip` from the table itself).

## Contributing

Bugs, ideas and PRs are welcome: [CONTRIBUTING.md](CONTRIBUTING.md). Vulnerabilities: [SECURITY.md](SECURITY.md). Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Licenses and attributions

- **Code:** [GNU AGPL-3.0](LICENSE). If you offer a modified Lantern as a network service, you must publish your changes.
- **Rules (SRD 5.2.1):** *This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License (https://creativecommons.org/licenses/by/4.0/legalcode).* ([CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/))
- **Music and ambience:** CC0 from OpenGameArt.org, authors in [apps/web/public/audio/CREDITS.md](apps/web/public/audio/CREDITS.md).
- **Icons:** [game-icons.net](https://game-icons.net) (CC-BY 3.0), see [apps/web/src/assets/icons/LICENSE.txt](apps/web/src/assets/icons/LICENSE.txt).
- **5e-database data:** see [packages/srd/NOTICE.md](packages/srd/NOTICE.md).

**Lantern is not affiliated with, endorsed or sponsored by Wizards of the Coast or D&D Beyond.** Dungeons & Dragons and D&D Beyond are trademarks of their owners. Lantern Link only uses the user's own session to read their own characters.

## Made with generative AI

This project was developed with the help of generative AI (Claude, by Anthropic): the code, texts and designs were generated and reviewed with AI assistance under the author's direction. Review and test it before using it in production.
