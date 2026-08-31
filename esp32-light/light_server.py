"""HTTP -> onboard RGB LED bridge for the Discord "on air" light (ESP32-S2).

MicroPython port of ../pi-light/light_server.py. Receives POSTs of
{inVoice, muted, deafened, streaming} from discord-rpc-helper running on the PC
and drives the Saola-1R's onboard WS2812 pixel.

If no update arrives for STALE_AFTER_MS (PC asleep, Discord closed, network down,
helper killed without a clean shutdown) the LED goes dark, so it never gets stuck
showing a status that is no longer true.

Config lives in config.py (copy config.example.py). Same wire protocol as
pi-light: POST to "/" (or "/?token=..."), body is the raw flags JSON.
"""

import gc
import json
import time

import machine
import neopixel
import network
import socket

try:
    import config
except ImportError:
    raise SystemExit(
        "esp32-light: no config.py -- copy config.example.py to config.py and fill it in"
    )

WIFI_SSID = config.WIFI_SSID
WIFI_PASS = config.WIFI_PASS
API_TOKEN = getattr(config, "API_TOKEN", "")
LIGHT_PORT = getattr(config, "LIGHT_PORT", 8000)
STALE_AFTER_MS = getattr(config, "STALE_AFTER_MS", 30_000)
BRIGHTNESS = getattr(config, "BRIGHTNESS", 0.3)
NEOPIXEL_PIN = getattr(config, "NEOPIXEL_PIN", 18)
HOSTNAME = getattr(config, "HOSTNAME", "esp32-light")
STATIC_IP = getattr(config, "STATIC_IP", None)

# state name -> (r, g, b) in 0..1  (identical to pi-light; scaled by BRIGHTNESS below)
COLORS = {
    "deafened":     (0.0, 0.0, 1.0),
    "muted":        (1.0, 0.0, 0.0),
    "streaming":    (1.0, 0.0, 1.0),
    "connected":    (0.0, 1.0, 0.0),
    "disconnected": (0.0, 0.0, 0.0),
    "stale":        (0.0, 0.0, 0.0),
}

_np = None
_last_update = 0
_is_stale = True


def derive(flags):
    if flags.get("deafened"):
        return "deafened"
    if flags.get("muted"):
        return "muted"
    if flags.get("streaming"):
        return "streaming"
    return "connected" if flags.get("inVoice") else "disconnected"


def set_state(name):
    r, g, b = COLORS.get(name, (0.0, 0.0, 0.0))
    scale = int(BRIGHTNESS * 255)
    _np[0] = (int(r * scale), int(g * scale), int(b * scale))
    _np.write()
    t = time.localtime()
    print("[%02d:%02d:%02d] %s" % (t[3], t[4], t[5], name))


def _touch(name):
    global _last_update, _is_stale
    _last_update = time.ticks_ms()
    _is_stale = False
    set_state(name)


def _check_stale():
    global _is_stale
    if not _is_stale and time.ticks_diff(time.ticks_ms(), _last_update) > STALE_AFTER_MS:
        set_state("stale")
        _is_stale = True


def _authorized(path, headers):
    if not API_TOKEN:
        return True
    supplied = ""
    if "token=" in path:
        supplied = path.split("token=", 1)[1].split("&", 1)[0]
    auth = headers.get("authorization", "")
    if auth[:7].lower() == "bearer ":
        supplied = auth[7:]
    return supplied == API_TOKEN


def _respond(conn, code, body):
    reason = {
        200: "OK", 400: "Bad Request", 401: "Unauthorized", 405: "Method Not Allowed",
    }.get(code, "OK")
    msg = (
        "HTTP/1.1 %d %s\r\n"
        "Content-Type: application/json\r\n"
        "Content-Length: %d\r\n"
        "Connection: close\r\n\r\n%s" % (code, reason, len(body), body)
    )
    try:
        conn.send(msg.encode())
    except OSError:
        pass


def _handle(conn):
    conn.settimeout(2.0)
    try:
        req = conn.recv(1024)
        if not req:
            return
        while b"\r\n\r\n" not in req and len(req) < 4096:
            chunk = conn.recv(1024)
            if not chunk:
                break
            req += chunk

        head, _, body = req.partition(b"\r\n\r\n")
        lines = head.split(b"\r\n")
        parts = lines[0].split(b" ") + [b"", b""]
        method = parts[0].decode()
        path = parts[1].decode()

        headers = {}
        for line in lines[1:]:
            k, _, v = line.partition(b":")
            headers[k.decode().strip().lower()] = v.decode().strip()

        if method != "POST":
            return _respond(conn, 405, '{"error":"method not allowed"}')
        if not _authorized(path, headers):
            return _respond(conn, 401, '{"error":"unauthorized"}')

        length = int(headers.get("content-length", "0") or "0")
        while len(body) < length:
            chunk = conn.recv(1024)
            if not chunk:
                break
            body += chunk

        try:
            flags = json.loads(body or b"{}")
        except (ValueError, OSError):
            return _respond(conn, 400, '{"error":"bad json"}')

        _touch(derive(flags))
        _respond(conn, 200, '{"ok":true}')
    except OSError:
        pass
    finally:
        conn.close()


def _connect_wifi():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    for attr in ("hostname", "dhcp_hostname"):
        try:
            wlan.config(**{attr: HOSTNAME})
            break
        except (OSError, ValueError):
            pass
    if STATIC_IP:
        wlan.ifconfig(STATIC_IP)
    if not wlan.isconnected():
        wlan.connect(WIFI_SSID, WIFI_PASS)
        for _ in range(60):
            if wlan.isconnected():
                break
            time.sleep(0.5)
    return wlan


def run():
    global _np
    _np = neopixel.NeoPixel(machine.Pin(NEOPIXEL_PIN), 1)
    set_state("stale")

    wlan = _connect_wifi()
    if wlan.isconnected():
        print("esp32-light on", wlan.ifconfig()[0], "port", LIGHT_PORT)
    else:
        print("esp32-light: wifi not connected yet, will keep retrying")

    addr = socket.getaddrinfo("0.0.0.0", LIGHT_PORT)[0][-1]
    s = socket.socket()
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(addr)
    s.listen(1)
    s.settimeout(1.0)
    print("esp32-light listening on :%d (stale after %dms)" % (LIGHT_PORT, STALE_AFTER_MS))

    while True:
        if not wlan.isconnected():
            print("wifi dropped, reconnecting...")
            try:
                wlan.connect(WIFI_SSID, WIFI_PASS)
            except OSError:
                pass
            time.sleep(1)
            _check_stale()
            continue
        try:
            conn, _ = s.accept()
        except OSError:  # accept() timeout -> just service the watchdog
            _check_stale()
            gc.collect()
            continue
        _handle(conn)
        _check_stale()


if __name__ == "__main__":
    run()
