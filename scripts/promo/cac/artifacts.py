"""Assemble review sheets and a thumbnail from extracted video frames."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

work, out = map(Path, sys.argv[1:3])
timing = json.loads((work / 'timings.json').read_text())
font = '/System/Library/Fonts/Helvetica.ttc'
tiles = sorted((work / 'contact').glob('frame-*.png'))
columns = 6
sheet = Image.new('RGB', (2112, 90 + ((len(tiles) + columns - 1) // columns) * 230), '#eef1ec')
draw = ImageDraw.Draw(sheet)
draw.text((24, 22), 'FixList CAC demo / every 3 seconds / 172.00 s', font=ImageFont.truetype(font, 30), fill='#16302b')
for i, f in enumerate(tiles):
    x, y = 24 + (i % columns) * 348, 90 + (i // columns) * 230
    sheet.paste(Image.open(f).convert('RGB'), (x, y))
    second = i * 3
    draw.text((x, y + 184), f'{second // 60:02}:{second % 60:02}', font=ImageFont.truetype(font, 25), fill='#16302b')
sheet.save(str(out) + '-demo-contact.png')

# Real app pixels, copied from the completed scene without retouching UI.
frame = Image.open(work / 'thumbnail-source.png').convert('RGB')
phone = frame.crop((1306, 40, 1782, 1042)).resize((304, 640), Image.Resampling.LANCZOS)
thumb = Image.new('RGB', (1280, 720), '#eef1ec'); d = ImageDraw.Draw(thumb)
d.rounded_rectangle((78, 152, 174, 163), 5, fill='#f4c430')
d.text((76, 200), 'FixList', font=ImageFont.truetype(font, 130, index=1), fill='#16302b')
d.text((84, 373), 'Fix what matters', font=ImageFont.truetype(font, 48), fill='#16302b')
d.text((84, 431), 'at home, together.', font=ImageFont.truetype(font, 48), fill='#16302b')
d.text((84, 571), 'Created by Andrew Lieu', font=ImageFont.truetype(font, 31), fill='#405c54')
d.text((84, 620), 'Congressional App Challenge · demo', font=ImageFont.truetype(font, 23), fill='#405c54')
thumb.paste(phone, (873, 40))
thumb.save(str(out) + '-thumbnail.png')
