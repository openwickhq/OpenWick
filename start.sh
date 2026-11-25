#!/bin/sh
# Run ./start.sh to start OpenWick.
cd "$(dirname "$0")" && node server.js --open
