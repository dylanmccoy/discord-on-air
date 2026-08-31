# Copy to config.py (gitignored) and fill in. light_server.py does `from config import *`.
# Push it to the board alongside light_server.py / main.py:
#   mpremote connect /dev/ttyUSB0 fs cp light_server.py main.py config.py :

WIFI_SSID = ""
WIFI_PASS = ""

# Must match API_TOKEN in the PC helper's .env. Leave "" to disable the check
# (fine on a trusted home LAN).
API_TOKEN = ""

# Keep 8000 so INGEST_URL matches pi-light's default.
LIGHT_PORT = 8000

# Milliseconds without a POST before the LED goes dark (helper heartbeats every 10s).
STALE_AFTER_MS = 30_000

# 0..1, scales the onboard pixel — it is retina-searing at full brightness.
BRIGHTNESS = 0.3

# Saola-1R onboard WS2812 data line.
NEOPIXEL_PIN = 18

# DHCP hostname the board registers (wlan.config(hostname=...)). Some routers then
# resolve it as <HOSTNAME> or <HOSTNAME>.local / .lan.
HOSTNAME = "esp32-light"

# None = DHCP. Otherwise a 4-tuple: (ip, netmask, gateway, dns).
STATIC_IP = None
