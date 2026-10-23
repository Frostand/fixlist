"""Local synthetic media for pipeline tests; never used by a final build."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

target = Path(sys.argv[1]); target.mkdir(parents=True, exist_ok=True)
jobs = json.loads(Path(sys.argv[2]).read_text())
font_file = '/System/Library/Fonts/Helvetica.ttc'
for job in jobs:
    w, h = job['width'], job['height']; name = job['name']
    transparent = job['transparent']
    image = Image.new('RGBA', (w, h), (0, 0, 0, 0) if transparent else '#eef1ec')
    draw = ImageDraw.Draw(image)
    if name.startswith('blank'):
        pass
    elif name == 'mask':
        draw.rectangle((0, 0, w, h), fill='black')
        draw.rounded_rectangle((0, 0, w - 1, h - 1), radius=52, fill='white')
    elif name == 'tap':
        draw.ellipse((4, 4, 56, 56), fill='#f4c43040', outline='#e4ad18', width=3)
    else:
        font = ImageFont.truetype(font_file, 32 if h < 200 else 65)
        draw.text((20, 20), 'STAND-IN: ' + name, font=font, fill='#16302b')
    image.save(target / (name + '.png'))
