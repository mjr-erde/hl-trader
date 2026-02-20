#!/bin/bash
# Log processor — summarizes new session logs via Ollama, then archives and rotates.
#
# Rotation policy:
#   - processed-*.log files: keep last 7 days (delete older)
#   - _archive.log: rotate to _archive.YYYY-MM-DD.log when > 50MB, start fresh

set -euo pipefail

# Add current directory to PATH for this session
export PATH="$PATH:$(pwd)"

# ── Configuration ──────────────────────────────────────────────────────────────
MODEL="${1:-llama3.2}"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
OUTPUT_FILE="processed-$TIMESTAMP.log"
SCRIPT_NAME=$(basename "$0")
ARCHIVE_FILE="_archive.log"
ARCHIVE_MAX_MB=50
PROCESSED_RETENTION_DAYS=7

echo "--- Initializing Ollama with model: $MODEL ---"

# Check if Ollama is running, if not, attempt to start it
if ! pgrep -x "ollama" > /dev/null; then
    echo "Ollama is not running. Starting ollama serve..."
    ollama serve > /dev/null 2>&1 &
    sleep 5
fi

# Pre-load the model
ollama pull "$MODEL"

echo "--- Gathering content from local files ---"

ALL_CONTENT=""
FILES_TO_ARCHIVE=()

for file in *; do
    if [[ -f "$file" && "$file" != "$SCRIPT_NAME" && "$file" != processed-* && "$file" != "$ARCHIVE_FILE" && "$file" != _archive.*.log ]]; then
        echo "Reading: $file"
        ALL_CONTENT+=$'\n\n--- Source: '"$file"$' ---\n'
        ALL_CONTENT+=$(cat "$file")
        FILES_TO_ARCHIVE+=("$file")
    fi
done

if [[ ${#FILES_TO_ARCHIVE[@]} -eq 0 ]]; then
    echo "--- No new log files to process ---"
    exit 0
fi

PROMPT="Read through the following text. Summarize key information discovered. Note trends, themes, or repeated information. Note obscure information. Summarize it into a conclusion no longer than 500 words.

Content to process:
$ALL_CONTENT"

echo "--- Sending data to agent... ---"

echo "$PROMPT" | ollama run "$MODEL" > "$OUTPUT_FILE"

echo "--- Done! Summary saved to $OUTPUT_FILE ---"

# ── Archive processed session logs ─────────────────────────────────────────────
echo "--- Archiving ${#FILES_TO_ARCHIVE[@]} log files into $ARCHIVE_FILE ---"

for file in "${FILES_TO_ARCHIVE[@]}"; do
    echo "" >> "$ARCHIVE_FILE"
    echo "===== $file (archived $TIMESTAMP) =====" >> "$ARCHIVE_FILE"
    cat "$file" >> "$ARCHIVE_FILE"
    rm "$file"
    echo "  Archived and removed: $file"
done

echo "--- Archive complete ---"

# ── Rotate _archive.log if > ARCHIVE_MAX_MB ────────────────────────────────────
if [[ -f "$ARCHIVE_FILE" ]]; then
    SIZE_MB=$(du -sm "$ARCHIVE_FILE" 2>/dev/null | cut -f1)
    if [[ "$SIZE_MB" -ge "$ARCHIVE_MAX_MB" ]]; then
        ROTATE_NAME="_archive.$(date +%Y-%m-%d).log"
        mv "$ARCHIVE_FILE" "$ROTATE_NAME"
        echo "--- Archive rotated: $ROTATE_NAME ($SIZE_MB MB) ---"
        touch "$ARCHIVE_FILE"
    fi
fi

# ── Delete processed-*.log files older than PROCESSED_RETENTION_DAYS ──────────
DELETED=0
for f in processed-*.log; do
    [[ -f "$f" ]] || continue
    if [[ $(find "$f" -mtime +"$PROCESSED_RETENTION_DAYS" 2>/dev/null) ]]; then
        rm "$f"
        echo "  Deleted old processed log: $f"
        DELETED=$((DELETED + 1))
    fi
done

if [[ $DELETED -gt 0 ]]; then
    echo "--- Deleted $DELETED processed log(s) older than ${PROCESSED_RETENTION_DAYS} days ---"
fi
