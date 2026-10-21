#!/bin/sh
# site/ -> a folder ready for GitHub Pages.   sh site/build.sh /ad599-app/ <version> _site
set -e
BASE="$1"; VERSION="$2"; OUT="$3"
SRC="$(dirname "$0")"
rm -rf "$OUT"; mkdir -p "$OUT"
cp -r "$SRC/." "$OUT/"
rm -f "$OUT/build.sh"
find "$OUT" \( -name '*.html' -o -name '*.js' \) -not -path '*/vendor/*' -not -path '*/templates/*' \
  -exec sed -i "s#__BASE__#${BASE}#g; s#__VERSION__#${VERSION}#g" {} +
# every top-level page gets a real index.html (deeper links like /w02/q/5 are served by 404.html)
for d in login logout admin admin/login admin/students $(cd "$SRC/templates" && ls -d w*/ | tr -d /); do
  mkdir -p "$OUT/$d"; cp "$OUT/index.html" "$OUT/$d/index.html"
done
cp "$OUT/index.html" "$OUT/404.html"
echo "built $OUT for base $BASE"
