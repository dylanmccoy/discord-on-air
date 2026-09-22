# Working with esp32-light from WSL2 + Windows

Notes/commands for this dev setup: repo lives in WSL2, board is flashed from
WSL2 via `usbipd`, but `discord-rpc-helper` has to run on Windows (needs
Discord desktop's local IPC, which WSL2 can't reach).

## USB passthrough (do this every time you reconnect the board)

In an **Admin PowerShell** on Windows:

```powershell
usbipd list                              # find the board's BUSID
usbipd bind --busid <BUSID>               # one-time only
usbipd attach --wsl --busid <BUSID>       # every time it's plugged in / after WSL restart
```

Optional: `usbipd attach --wsl --busid <BUSID> --auto-attach` to skip doing this manually going forward.

Back in WSL, confirm it showed up:

```bash
ls -la /dev/ttyUSB*
```

If a previous `mpremote`/`esptool` command wedged (hung with zero output, `D`
state in `ps aux`, un-killable even with `kill -9`), that's a known WSL2
usbipd serial quirk. Fix: `usbipd detach` + physically unplug/replug + `usbipd
attach --wsl` again. This creates a *new* device node (e.g. `/dev/ttyUSB1`
instead of `0`) — use the new one, ignore the wedged old one.

## Flash MicroPython (one-time per board, or to reflash)

```bash
cd esp32-light
uv tool install esptool      # one-time
uv tool install mpremote     # one-time

# download mode: hold BOOT, tap RST, release BOOT
esptool --chip esp32s2 --port /dev/ttyUSB0 erase-flash
esptool --chip esp32s2 --port /dev/ttyUSB0 write-flash 0x1000 /path/to/ESP32_GENERIC_S2-*.bin
```

Latest stable firmware: https://micropython.org/download/ESP32_GENERIC_S2/
(pick the newest non-preview `.bin`).

## Push app files / config changes to the board

Any time `light_server.py`, `main.py`, or `config.py` changes:

```bash
cd esp32-light
mpremote connect /dev/ttyUSB0 fs cp light_server.py main.py config.py :
mpremote connect /dev/ttyUSB0 reset
```

(Swap in whichever `/dev/ttyUSBn` is currently live — check with `ls /dev/ttyUSB*` first.)

To push just one file, e.g. after editing `config.py` only:

```bash
mpremote connect /dev/ttyUSB0 fs cp config.py :
mpremote connect /dev/ttyUSB0 reset
```

## Quick checks without touching Discord

Get the board's current IP (interrupts `main.py` briefly, resume with `reset` after):

```bash
mpremote connect /dev/ttyUSB0 exec "import network; w=network.WLAN(network.STA_IF); print(w.isconnected(), w.ifconfig())"
mpremote connect /dev/ttyUSB0 reset
```

Test the light directly (bypasses Discord/helper entirely):

```bash
curl -X POST 'http://<board-ip>:8000/?token=<API_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"inVoice":true,"muted":true}'      # should go red
```

`mpremote ... repl` does **not** work from this WSL bash tool (needs a real
TTY) — use `exec` for one-off commands instead.

## Running discord-rpc-helper on Windows

The repo's WSL path (`\\wsl$\Ubuntu\...`) can't be used directly:
- `cmd.exe` (which `npm.cmd` shells out to) can't use a UNC path as its
  working directory — silently drops to `C:\Windows`.
- `net use`-mapping `\\wsl$` as a drive letter doesn't work either — it's a
  special filesystem provider, not a real SMB share (`System error 64`).

Workaround: copy the folder to a native Windows path and run everything from
there. Re-run this whenever `discord-rpc-helper` code or `.env` changes on
the WSL side:

```powershell
robocopy \\wsl$\Ubuntu\home\dylan\projects\dylan\discord-on-air\discord-rpc-helper C:\Users\dylan\discord-rpc-helper /E
cd C:\Users\dylan\discord-rpc-helper
npm install
npm start
```

## Task Scheduler (auto-start discord-rpc-helper on login)

One-time setup, in PowerShell on `C:\Users\dylan\discord-rpc-helper`:

```powershell
@"
@echo off
cd /d C:\Users\dylan\discord-rpc-helper
node index.js >> helper.log 2>&1
"@ | Out-File -Encoding ascii C:\Users\dylan\discord-rpc-helper\start-helper.bat

schtasks /create /tn "discord-rpc-helper" /tr "C:\Users\dylan\discord-rpc-helper\start-helper.bat" /sc onlogon /rl limited
```

Day-to-day commands:

```powershell
schtasks /run /tn "discord-rpc-helper"     # start now (without logging in/out)
schtasks /end /tn "discord-rpc-helper"     # stop
schtasks /query /tn "discord-rpc-helper"   # check status
schtasks /delete /tn "discord-rpc-helper" /f   # remove entirely
```

Restart after changing `.env` or code (stop + start):

```powershell
schtasks /end /tn "discord-rpc-helper"
schtasks /run /tn "discord-rpc-helper"
```

Logs land in `C:\Users\dylan\discord-rpc-helper\helper.log` (appended, no
console window — check this instead of trying to watch it live).

## Notes

- Board's static IP: set via `STATIC_IP` in `config.py` (no router DHCP
  reservation access on this network) — must stay on the same Wi-Fi/subnet to
  keep working.
- `BRIGHTNESS` in `config.py` controls onboard LED brightness, 0..1.
- After any `config.py`/`light_server.py` push + reset, the board shows no
  color until the next heartbeat from `discord-rpc-helper` arrives (up to ~10s).
