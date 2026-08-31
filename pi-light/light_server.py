#!/usr/bin/env python3
"""HTTP -> RGB LED bridge for the Discord "on air" light.

Receives POSTs of {inVoice, muted, deafened, streaming} from discord-rpc-helper
running on the PC and drives an RGB LED on the Pi's GPIO.

If no update arrives for STALE_AFTER seconds (PC asleep, Discord closed, network
down, helper killed without a clean shutdown) the LED goes dark, so it never
gets stuck showing a status that is no longer true.

Config via environment variables (see .env.example):
    LIGHT_HOST    bind address                (default 0.0.0.0)
    LIGHT_PORT    bind port                   (default 8000)
    API_TOKEN     shared secret; "" disables the check
    STALE_AFTER   seconds before going dark   (default 30)
    LED_PINS      BCM pins "red,green,blue"   (default 17,27,22)
    LED_ACTIVE_HIGH  "1" common-cathode (default), "0" common-anode
"""

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from gpiozero import RGBLED

HOST = os.environ.get("LIGHT_HOST", "0.0.0.0")
PORT = int(os.environ.get("LIGHT_PORT", "8000"))
TOKEN = os.environ.get("API_TOKEN", "")
STALE_AFTER = float(os.environ.get("STALE_AFTER", "30"))
PINS = [int(p) for p in os.environ.get("LED_PINS", "17,27,22").split(",")]
ACTIVE_HIGH = os.environ.get("LED_ACTIVE_HIGH", "1") != "0"

led = RGBLED(red=PINS[0], green=PINS[1], blue=PINS[2], active_high=ACTIVE_HIGH)

# state name -> (r, g, b) in 0..1
COLORS = {
    "deafened":     (0.0, 0.0, 1.0),
    "muted":        (1.0, 0.0, 0.0),
    "streaming":    (1.0, 0.0, 1.0),
    "connected":    (0.0, 1.0, 0.0),
    "disconnected": (0.0, 0.0, 0.0),
    "stale":        (0.0, 0.0, 0.0),
}

_last_update = 0.0
_lock = threading.Lock()


def derive(flags):
    if flags.get("deafened"):
        return "deafened"
    if flags.get("muted"):
        return "muted"
    if flags.get("streaming"):
        return "streaming"
    return "connected" if flags.get("inVoice") else "disconnected"


def set_state(name):
    led.color = COLORS.get(name, (0.0, 0.0, 0.0))
    print(f"[{time.strftime('%H:%M:%S')}] {name}", flush=True)


class Handler(BaseHTTPRequestHandler):
    def _authorized(self):
        if not TOKEN:
            return True
        supplied = ""
        if "token=" in (self.path or ""):
            supplied = self.path.split("token=", 1)[1].split("&", 1)[0]
        auth = self.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            supplied = auth[7:]
        return supplied == TOKEN

    def do_POST(self):
        global _last_update
        if not self._authorized():
            self.send_response(401)
            self.end_headers()
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            flags = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            self.send_response(400)
            self.end_headers()
            return
        with _lock:
            _last_update = time.monotonic()
            set_state(derive(flags))
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, *_):  # silence per-request logging
        pass


def watchdog():
    global _last_update
    while True:
        time.sleep(1)
        with _lock:
            if _last_update and time.monotonic() - _last_update > STALE_AFTER:
                set_state("stale")
                _last_update = 0.0


if __name__ == "__main__":
    set_state("stale")
    threading.Thread(target=watchdog, daemon=True).start()
    print(f"pi-light listening on {HOST}:{PORT} (stale after {STALE_AFTER}s)", flush=True)
    try:
        ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        led.off()
