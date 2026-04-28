#!/bin/bash
# Fetches portrait photos from Wikipedia for each entry in quotes.json.
# Re-run anytime you add/change entries — existing photos are skipped.
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

# Reset credits file
{
  echo "# Photo Credits"
  echo ""
  echo "All photos sourced from Wikimedia Commons via the Wikipedia API."
  echo "License terms vary per image — most are public domain or Creative Commons."
  echo "Visit each linked source for license details."
  echo ""
} > "$CREDITS_FILE"

count_total=$(jq 'length' "$QUOTES_FILE")
count_done=0
count_skipped=0
count_failed=0

jq -c '.[]' "$QUOTES_FILE" | while read -r entry; do
  slug=$(echo "$entry" | jq -r '.photoSlug')
  title=$(echo "$entry" | jq -r '.wikiTitle')
  name=$(echo "$entry" | jq -r '.name')
  output="$PHOTOS_DIR/$slug.jpg"

  if [[ -f "$output" ]]; then
    count_skipped=$((count_skipped + 1))
    continue
  fi

  echo "→ [$name] fetching from $title"

  # URL-encode the title (basic — handles spaces and parens)
  encoded_title=$(echo -n "$title" | jq -sRr @uri)

  api_url="https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&titles=${encoded_title}&pithumbsize=1500&format=json"

  response=$(curl -s -A "$USER_AGENT" "$api_url")
  thumb_url=$(echo "$response" | jq -r '.query.pages | to_entries[0].value.thumbnail.source // empty')
  page_image=$(echo "$response" | jq -r '.query.pages | to_entries[0].value.pageimage // empty')

  if [[ -z "$thumb_url" ]]; then
    echo "  ✗ No image found for $title"
    count_failed=$((count_failed + 1))
    continue
  fi

  curl -s -A "$USER_AGENT" -L -o "$output" "$thumb_url"

  # Resize to max 1500px on longest side, just in case
  sips -Z 1500 "$output" > /dev/null 2>&1 || true

  # Append credit
  echo "- **$name** — \`$slug.jpg\` — [\`File:$page_image\`](https://commons.wikimedia.org/wiki/File:$page_image) — via [Wikipedia: $title](https://en.wikipedia.org/wiki/$title)" >> "$CREDITS_FILE"

  count_done=$((count_done + 1))

  # Be polite to Wikipedia
  sleep 0.3
done

echo ""
echo "Total entries:   $count_total"
echo "Already on disk: (re-run skips existing)"
echo "Done. Photos in $PHOTOS_DIR/"
echo "Credits: $CREDITS_FILE"
