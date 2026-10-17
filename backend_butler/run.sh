#!/usr/bin/with-contenv bashio
bashio::log.info "Starting Backend Butler"
cd /app
exec node dist/server.mjs
