# esp32-light

The ESP32-S2 variant of [`pi-light`](../pi-light) — same PC side, same wire
protocol, no Raspberry Pi. A MicroPython port of `pi-light/light_server.py` that
runs a tiny HTTP server on your Wi-Fi and drives the **onboard WS2812 RGB LED**
of an Espressif **ESP32-S2-Saola-1R** (Adafruit 4693).

```
[ PC ]  Discord desktop ──IPC──► discord-rpc-helper ──HTTP POST──► [ ESP32-S2 ]  light_server.py ──► onboard RGB LED
```

Because the protocol is identical to `pi-light`, **`discord-rpc-helper` needs no
changes** — point its `INGEST_URL` at the board (`http://<esp-ip>:8000/`).

## State → colour

| state          | when                                             | colour  |
|----------------|--------------------------------------------------|---------|
| `deafened`     | deafen toggle on                                 | blue    |
| `muted`        | mic muted (in a call **or idle**)                | red     |
| `streaming`    | screen sharing (not reported by RPC — stays off) | magenta |
| `connected`    | in a voice channel, mic live                     | green   |
| `disconnected` | not in a voice channel, not muted                | off     |
| *stale*        | no POST for `STALE_AFTER_MS` (PC asleep / Discord closed / helper down) | off |

Priority is deafen > mute > streaming > connected. `BRIGHTNESS` in `config.py`
scales the (very bright) onboard pixel.

## Hardware & power

- **LED:** nothing to wire — the Saola-1R's onboard WS2812 is on `GPIO18`.
- **Power:** any 5 V USB-C supply into the board's own USB-C port works. For a
  built enclosure, use the **Adafruit 4090 USB-C Breakout (Downstream)**: solder
  `VBUS → 5V` and `GND → GND` on the Saola header, leave D+/D-/CC/SBU unconnected.
  Don't also plug the Saola's USB port into a computer while the 5 V pin is fed
  (back-feed).

## Flash MicroPython (one-time)

```bash
pip install esptool mpremote
# grab the latest ESP32_GENERIC_S2 .bin from
#   https://micropython.org/download/ESP32_GENERIC_S2/

# download mode: hold BOOT, tap RST, release BOOT
esptool.py --chip esp32s2 --port /dev/ttyUSB0 erase_flash
esptool.py --chip esp32s2 --port /dev/ttyUSB0 write_flash 0x1000 ESP32_GENERIC_S2-*.bin
# tap RST
```

(Port is often `/dev/ttyUSB0` on Linux via the onboard CP2102N, `/dev/ttyACM0`
if you use the native-USB jack, `COMx` on Windows.)

## Configure & push the app

```bash
cd esp32-light
cp config.example.py config.py     # set WIFI_SSID / WIFI_PASS / API_TOKEN
mpremote connect /dev/ttyUSB0 fs cp light_server.py main.py config.py :
mpremote connect /dev/ttyUSB0 reset
```

`main.py` auto-runs on boot. Watch it come up (it prints the assigned IP):

```bash
mpremote connect /dev/ttyUSB0 repl      # Ctrl-] to exit
```

## Networking

The PC needs a stable address for the board:

- The board registers `HOSTNAME` (default `esp32-light`) as its DHCP hostname —
  many routers then resolve `esp32-light` or `esp32-light.lan`.
- More reliable: give it a DHCP reservation, or set `STATIC_IP` in `config.py`.
- The boot log always prints the current IP.

## Test without the PC

```bash
curl -X POST 'http://<esp-ip>:8000/?token=YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"inVoice":true,"muted":true}'          # LED red
# ... '{"inVoice":true,"deafened":true}'      # blue
# ... '{"inVoice":true}'                      # green
# ... '{}'                                    # off
```

Stop POSTing for `STALE_AFTER_MS` (30 s) → the LED blanks itself.

## Point the helper at it

In `discord-rpc-helper/.env`:

```env
INGEST_URL=http://<esp-ip>:8000/
API_TOKEN=<same string as config.py>
```

## Behaviour

| Situation | Result |
|-----------|--------|
| You mute (in call or idle) | helper POSTs immediately → LED red in <1s |
| PC sleeps | POSTs stop → LED blanks after `STALE_AFTER_MS` |
| PC wakes | helper reconnect loop resumes → LED correct within ~10s |
| You quit Discord | helper retries every 3s; LED off via watchdog meanwhile |
| You stop the helper (Ctrl-C / `systemctl stop`) | one final all-false POST → LED off right away |
| Board loses Wi-Fi | main loop reconnects; LED blanks while offline |
| Board reboots | `main.py` autostarts, LED off until the next POST |
