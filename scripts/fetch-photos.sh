#!/bin/bash
# Fetches portrait photos from Wikipedia for each entry in quotes.json.
# Safe to re-run any time:
#   - Photos already on disk are not re-downloaded.
#   - CREDITS.md is rebuilt from scratch each run, but existing credit
#     lines are preserved for slugs we don't (or can't) refetch from
#     Wikipedia — including manual entries with empty wikiTitle, and
#     entries whose Wikipedia page is currently returning no thumbnail.
#
# Photos are served from Wikimedia Commons. We apply the B&W treatment
# at render time via CSS, so the on-disk files keep their original color.

set -e

cd "$(dirname "$0")/.."

QUOTES_FILE="quotes.json"
PHOTOS_DIR="assets/photos"
CREDITS_FILE="$PHOTOS_DIR/CREDITS.md"
USER_AGENT="DeskQuotes/1.0 (https://github.com/WadeSellers/desk-quotes; wade@wadesellers.com)"

mkdir -p "$PHOTOS_DIR"

# ---------------------------------------------------------------------------
# Snapshot the existing credits file before we overwrite it. We use a temp
# file (not an associative array — bash 3.2 on macOS doesn't have those) and
# look up by slug so the rebuild step can preserve credit lines for entries
# we don't refetch this run.
# ---------------------------------------------------------------------------

existing_credits_tmp=$(mktemp)
trap 'rm -f "$existing_credits_tmp"' EXIT

if [[ -f "$CREDITS_FILE" ]]; then
  # Match lines like:  - **Name** — `slug.jpg` — ...
  while IFS= read -r line; do
    slug=$(echo "$line" | sed -E 's/.*`([a-zA-Z0-9_-]+)\.jpg`.*/\1/')
    if [[ -n "$slug" && "$slug" != "$line" ]]; then
      printf '%s\t%s\n' "$slug" "$line" >> "$existing_credits_tmp"
    fi
  done < <(grep -E '`[a-zA-Z0-9_-]+\.jpg`' "$CREDITS_FILE" 2>/dev/null || true)
fi

# Returns the previous credit line for $1, if any.
lookup_credit() {
  local slug="$1"
  awk -v s="$slug" -F'\t' '$1 == s { sub(/^[^\t]+\t/, ""); print; exit }' \
    "$existing_credits_tmp"
}

# ---------------------------------------------------------------------------
# Reset CREDITS.md with a fresh header.
# ---------------------------------------------------------------------------

{
  echo "# Photo Credits"
  echo ""
  echo "Most photos are sourced from Wikimedia Commons via the Wikipedia API."
  echo "License terms vary per image — many are public domain or Creative"
  echo "Commons; non-Wikipedia entries are noted inline. Visit each linked"
  echo "source for license details."
  echo ""
} > "$CREDITS_FILE"

count_total=$(jq 'length' "$QUOTES_FILE")
count_fetched=0
count_skipped=0
count_preserved=0
count_failed=0

# Process substitution (rather than `jq | while`) so the loop runs in the
# main shell — counter increments persist past the loop.
while read -r entry; do
  slug=$(echo "$entry" | jq -r '.photoSlug')
  title=$(echo "$entry" | jq -r '.wikiTitle')
  name=$(echo "$entry" | jq -r '.name')
  output="$PHOTOS_DIR/$slug.jpg"

  # Manual / no-wiki entry — preserve any existing credit verbatim. If
  # there's no prior credit line for this slug, warn and skip the credit
  # (the slideshow will still try to load the photo if the file exists).
  if [[ -z "$title" || "$title" == "null" ]]; then
    existing=$(lookup_credit "$slug")
    if [[ -n "$existing" ]]; then
      echo "$existing" >> "$CREDITS_FILE"
      count_preserved=$((count_preserved + 1))
    else
      echo "ⓘ [$name] no wikiTitle and no existing credit — credit omitted"
    fi
    continue
  fi

  # Query Wikipedia for the page image metadata.
  encoded_title=$(echo -n "$title" | jq -sRr @uri)
  api_url="https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&titles=${encoded_title}&pithumbsize=1500&format=json"
  response=$(curl -s -A "$USER_AGENT" "$api_url" || true)
  thumb_url=$(echo "$response" | jq -r '.query.pages | to_entries[0].value.thumbnail.source // empty' 2>/dev/null || true)
  page_image=$(echo "$response" | jq -r '.query.pages | to_entries[0].value.pageimage // empty' 2>/dev/null || true)

  # API returned nothing — fall back to the old credit if we have one and
  # the photo file still exists locally; otherwise warn and skip.
  if [[ -z "$thumb_url" ]]; then
    existing=$(lookup_credit "$slug")
    if [[ -n "$existing" && -f "$output" ]]; then
      echo "  ⚠ [$name] API returned no image for $title — preserving prior credit"
      echo "$existing" >> "$CREDITS_FILE"
      count_preserved=$((count_preserved + 1))
    else
      echo "  ✗ [$name] no image found for $title and no fallback"
      count_failed=$((count_failed + 1))
    fi
    continue
  fi

  if [[ -f "$output" ]]; then
    count_skipped=$((count_skipped + 1))
  else
    echo "→ [$name] fetching from $title"
    curl -s -A "$USER_AGENT" -L -o "$output" "$thumb_url"
    sips -Z 1500 "$output" > /dev/null 2>&1 || true
    count_fetched=$((count_fetched + 1))
    sleep 0.3   # be polite to Wikipedia between downloads
  fi

  # Always write a fresh credit line — this is the bug fix. Previously
  # credits were only written for newly-downloaded photos, so re-running
  # the script wiped credits for everything already on disk.
  echo "- **$name** — \`$slug.jpg\` — [\`File:$page_image\`](https://commons.wikimedia.org/wiki/File:$page_image) — via [Wikipedia: $title](https://en.wikipedia.org/wiki/$title)" >> "$CREDITS_FILE"
done < <(jq -c '.[]' "$QUOTES_FILE")

echo ""
echo "Total entries:    $count_total"
echo "Fetched:          $count_fetched"
echo "Already on disk:  $count_skipped"
echo "Preserved:        $count_preserved   (manual / API fallback)"
echo "Failed:           $count_failed"
echo "Done. Photos in $PHOTOS_DIR/"
echo "Credits: $CREDITS_FILE"
