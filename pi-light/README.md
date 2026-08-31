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

## Run

```bash
cd discord-on-air/pi-light
python3 -m venv .venv && . .venv/bin/activate      # optional
pip install -r requirements.txt                    # usually already present on Pi OS
cp .env.example .env                                # set API_TOKEN, pins
set -a; . ./.env; set +a
python3 light_server.py
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
