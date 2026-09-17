#!/bin/sh
cd /opt/redmi-control
nohup /usr/bin/node server/index.mjs >/dev/null 2>&1 &
