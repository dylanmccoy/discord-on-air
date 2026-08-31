# MicroPython runs boot.py then main.py on power-up. Keep the app in its own
# module so it can also be imported / rerun from the REPL without a reset:
#   import light_server; light_server.run()
import light_server

light_server.run()
