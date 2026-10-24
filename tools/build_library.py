"""Builds the photo library from the photos dropped into the `library/` folder.

For every photo there it writes, into `assets/library/`:
  {id}.jpg        the photo the puzzle is cut from (longest side at most 1600 px)
  {id}-thumb.jpg  a small picture for the library grid
and lists them all in `assets/library/library.json`, which the app reads.

Only new or changed photos are processed, duplicates are skipped, and photos removed from the
folder are removed from the library too. Uses macOS `sips` for resizing, so it also reads
HEIC photos from an iPhone.

Run it with:  python3 tools/build_library.py
(tools/serve.py runs it automatically whenever the app loads the library.)
"""

import hashlib
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "library"
OUTPUT = ROOT / "assets" / "library"
MANIFEST = OUTPUT / "library.json"

PHOTO_TYPES = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".tif", ".tiff"}
FULL_SIDE = 1600
THUMB_SIDE = 360


def natural_key(path):
    """Sorts "2 Lake" before "10 Sea", so numbering files sets their order."""
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", path.name)]


def display_name(path):
    """'03_lake-pier.jpg' -> 'Lake pier'."""
    name = re.sub(r"^\d+[\s._-]*", "", path.stem)  # an ordering number in front is not part of the name
    name = re.sub(r"[_-]+", " ", name).strip() or path.stem
    return name[0].upper() + name[1:]


def slug(text):
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "photo"


def file_hash(path):
    digest = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resize(source, target, side, quality):
    subprocess.run(
        ["sips", "-Z", str(side), "-s", "format", "jpeg", "-s", "formatOptions", str(quality),
         str(source), "--out", str(target)],
        check=True, capture_output=True,
    )


def image_size(path):
    out = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
                         check=True, capture_output=True, text=True).stdout
    width = int(re.search(r"pixelWidth: (\d+)", out).group(1))
    height = int(re.search(r"pixelHeight: (\d+)", out).group(1))
    return width, height


def previous_hashes():
    """Which photo each id was made from last time, so replaced photos are noticed."""
    try:
        return {p["id"]: p.get("hash") for p in json.loads(MANIFEST.read_text(encoding="utf-8"))["photos"]}
    except (OSError, ValueError, KeyError):
        return {}


def build(verbose=True):
    SOURCE.mkdir(exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    log = print if verbose else (lambda *a: None)

    before = previous_hashes()
    photos, seen_hashes, used_ids = [], {}, set()
    for source in sorted(SOURCE.iterdir(), key=natural_key):
        if source.suffix.lower() not in PHOTO_TYPES or source.name.startswith("."):
            continue
        digest = file_hash(source)
        if digest in seen_hashes:
            log(f"skipped {source.name}: same photo as {seen_hashes[digest]}")
            continue
        seen_hashes[digest] = source.name

        name = display_name(source)
        photo_id, n = slug(name), 2
        while photo_id in used_ids:  # two different photos with the same name
            photo_id, n = f"{slug(name)}-{n}", n + 1
        used_ids.add(photo_id)

        full = OUTPUT / f"{photo_id}.jpg"
        thumb = OUTPUT / f"{photo_id}-thumb.jpg"
        try:
            if before.get(photo_id) != digest or not full.exists() or not thumb.exists():
                resize(source, full, FULL_SIDE, 85)
                resize(source, thumb, THUMB_SIDE, 72)
                log(f"added {source.name}")
            width, height = image_size(full)
        except (subprocess.CalledProcessError, AttributeError):
            log(f"skipped {source.name}: could not read this image")
            used_ids.discard(photo_id)
            continue
        photos.append({"id": photo_id, "name": name, "width": width, "height": height, "hash": digest})

    # Remove pictures of photos that are no longer in the folder.
    keep = {f"{p['id']}{suffix}.jpg" for p in photos for suffix in ("", "-thumb")}
    for old in OUTPUT.glob("*.jpg"):
        if old.name not in keep:
            old.unlink()
            log(f"removed {old.name}")

    text = json.dumps({"photos": photos}, indent=2, ensure_ascii=False) + "\n"
    if not MANIFEST.exists() or MANIFEST.read_text(encoding="utf-8") != text:
        MANIFEST.write_text(text, encoding="utf-8")
    log(f"library: {len(photos)} photos")
    return photos


if __name__ == "__main__":
    build(verbose="--quiet" not in sys.argv)
