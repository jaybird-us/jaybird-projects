#!/bin/sh
# Docker entrypoint for jayBird Projects
# Handles volume mount permissions before starting the app

# Data directory path
DATA_DIR="/app/data"

# Ensure data directory exists and is writable
if [ ! -d "$DATA_DIR" ]; then
    mkdir -p "$DATA_DIR"
fi

# Check if we can write to the data directory
if ! touch "$DATA_DIR/.write-test" 2>/dev/null; then
    echo "Warning: Cannot write to $DATA_DIR - database may not persist"
else
    rm -f "$DATA_DIR/.write-test"
fi

# Start the application
exec node src/index.js
