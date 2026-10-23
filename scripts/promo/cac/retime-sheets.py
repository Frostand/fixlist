import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

sidecar, folder = map(Path, sys.argv[1:3])
data = json.loads(sidecar.read_text()); events = data['events']
font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 23)
small = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 20)
for page in range((len(events) + 3) // 4):
    sheet = Image.new('RGB', (1632, 2 * 970), '#eef1ec'); draw = ImageDraw.Draw(sheet)
    for j, e in enumerate(events[page * 4:(page + 1) * 4]):
        x, y = (j % 2) * 816, (j // 2) * 970
        label = f'{page * 4 + j}: {e["label"]}'
        draw.text((x + 8, y + 6), label[:62], font=font, fill='#16302b')
        for k, key in enumerate(['before', 'after']):
            evidence = e.get('evidence') or {}
            if key not in evidence: continue
            im = Image.open(evidence[key]).convert('RGB')
            if k == 0 and 'x' in e and 'y' in e:
                d = ImageDraw.Draw(im); tx, ty = e['x'], e['y']; d.ellipse((tx - 14, ty - 14, tx + 14, ty + 14), outline='#e5ad16', width=3)
            sheet.paste(im, (x + k * 408, y + 72))
            t = evidence[f'{key}Time']; draw.text((x + k * 408 + 8, y + 39), f'{key} {t:.3f}s', font=small, fill='#405c54')
    sheet.save(folder / f'review-{page:02}.png')
