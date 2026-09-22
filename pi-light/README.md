# pi-light

The Raspberry Pi half of the "light only matters while my PC is on" setup.

A ~120-line HTTP server that receives voice-state POSTs from
[`discord-rpc-helper`](../discord-rpc-helper) on the PC and drives an RGB LED.
No Discord bot, no Node, no cloud.

```
[ PC ]  Discord desktop ──IPC──► discord-rpc-helper ──HTTP POST──► [ Pi ] light_server.py ──► RGB LED
```

## State → colour

| state          | when                                  | colour (default) |
|----------------|---------------------------------------|------------------|
| `deafened`     | deafen toggle on                      | blue             |
| `muted`        | mic muted (in a call **or idle**)     | red              |
| `streaming`    | screen sharing (not reported by RPC — stays off) | magenta |
| `connected`    | in a voice channel, mic live          | green            |
| `disconnected` | not in a voice channel, not muted     | off              |
| *stale*        | no update for `STALE_AFTER`s (PC asleep / Discord closed / helper down) | off |

Priority is deafen > mute > streaming > connected, so "muted while not in a
call" still shows red.

## Wiring

Common-cathode RGB LED: each colour leg → a 220–330 Ω resistor → a GPIO pin;
common leg → GND. Defaults are BCM **17 / 27 / 22** for R / G / B. For a
common-anode LED, tie the common leg to 3V3 and set `LED_ACTIVE_HIGH=0`.

Raspberry Pi OS Bookworm ships gpiozero + the lgpio backend already. If `uv run`
fails to import gpiozero's lgpio backend, install the system libs and drop
`system-site-packages = true` under `[tool.uv]` in `pyproject.toml`:

```bash
sudo apt install python3-gpiozero python3-lgpio
```

## Run

```bash
cd discord-on-air/pi-light
curl -LsSf https://astral.sh/uv/install.sh | sh      # one-time, if uv isn't installed
uv sync                                                # creates .venv, installs gpiozero
cp .env.example .env                                   # set API_TOKEN, pins
set -a; . ./.env; set +a
uv run light_server.py
```

As a service: edit paths/`User` in `pi-light.service`, then

```bash
sudo cp pi-light.service /etc/systemd/system/
sudo systemctl enable --now pi-light
journalctl -u pi-light -f
```

## Test without the PC

```bash
curl -X POST 'http://localhost:8000/?token=YOURTOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"inVoice":true,"muted":true}'
```
