"""
Bake a two-tone placeholder into every photo in src/data/cityPhotos.json.

The journey's contact sheet shows 2,297 tiles, and a tile scrolled into view
waits for its thumbnail. A grey box there reads as a hole; the photo's own
colours — the average of its top half over the average of its bottom half,
sky over ground — read as the photo arriving. The field is `tone`:
"rrggbb,rrggbb".

Source is the local original in photos/cities/<code>/, matched to the entry by
the EXIF capture time (the same time the upload wrote into the entry's date),
so no request leaves the machine. A photo with no local match is fetched once
from Cloudinary at the sheet's own size (w_480) — pass --fetch to allow that.
Only entries without a tone are touched; run it again after adding photos.

    python3 scripts/add-photo-tones.py            # count what would be done
    python3 scripts/add-photo-tones.py --write    # local matches only
    python3 scripts/add-photo-tones.py --write --fetch
"""
import io, json, os, sys, urllib.request
from PIL import Image, ImageOps

WRITE = '--write' in sys.argv
FETCH = '--fetch' in sys.argv
DATA = 'src/data/cityPhotos.json'


def tone(im):
    im = ImageOps.exif_transpose(im).convert('RGB')
    im.thumbnail((64, 64))
    small = im.resize((1, 2), Image.BOX)
    top, bottom = small.getpixel((0, 0)), small.getpixel((0, 1))
    return ','.join('%02x%02x%02x' % px for px in (top, bottom))


def local_index(code):
    d = f'photos/cities/{code}'
    out = {}
    if not os.path.isdir(d):
        return out
    for f in os.listdir(d):
        if f.startswith('.'):
            continue
        try:
            im = Image.open(os.path.join(d, f))
            t = (im.getexif().get_ifd(0x8769).get(36867) or im.getexif().get(306) or '')
        except Exception:
            continue
        if t:
            # "2016:11:20 20:36:51" -> "2016-11-20T20:36:51"
            out.setdefault(t[:10].replace(':', '-') + 'T' + t[11:19], os.path.join(d, f))
    return out


data = json.load(open(DATA))
local = fetched = missing = kept = 0
for city, entry in data.items():
    todo = [p for p in entry['photos'] if not p.get('tone')]
    kept += len(entry['photos']) - len(todo)
    if not todo:
        continue
    idx = local_index(entry['cityCode'])
    for p in todo:
        path = idx.get((p.get('date') or '')[:19])
        if path:
            local += 1
            if WRITE:
                p['tone'] = tone(Image.open(path))
        elif FETCH and p.get('url'):
            fetched += 1
            if WRITE:
                url = p['url'].replace('/f_auto,q_auto/', '/f_jpg,q_auto:good,w_480/')
                p['tone'] = tone(Image.open(io.BytesIO(urllib.request.urlopen(url, timeout=30).read())))
        else:
            missing += 1

print(f'already {kept}, local {local}, fetched {fetched}, no source {missing}')
if WRITE:
    open(DATA, 'w').write(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
