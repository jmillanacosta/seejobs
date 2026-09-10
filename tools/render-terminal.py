"""Rasterize captured Ink cells with an explicit font file and fixed cell positions.

Requires Pillow and Ubuntu Mono (resolved by fontconfig). The SVG embeds the same
PNG so GitHub, browsers, and image converters cannot substitute another font.
"""
import base64
import io
import json
import subprocess
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

frame = json.load(sys.stdin)
fonts = {}
missing = {}
for weight in ('Regular', 'Bold'):
    path = subprocess.check_output(['fc-match', '-f', '%{file}', frame['font'] + ':style=' + weight], text=True)
    family = subprocess.check_output(['fc-match', '-f', '%{family}', frame['font'] + ':style=' + weight], text=True)
    if frame['font'] not in family:
        raise SystemExit('Install Ubuntu Mono before generating screenshots; font substitution is disabled.')
    fonts[weight] = ImageFont.truetype(path, 36)
    missing[weight] = bytes(fonts[weight].getmask(chr(0x10ffff)))
fallback_path = subprocess.check_output(['fc-match', '-f', '%{file}', 'DejaVu Sans Mono'], text=True)
fallback = ImageFont.truetype(fallback_path, 32)
# Render at 2x resolution for crisp text, retaining a true monospace grid.
cell_w, cell_h, pad = 18, 44, 32
width, height = frame['columns'] * cell_w + pad * 2, frame['rows'] * cell_h + pad * 2
im = Image.new('RGB', (width, height), frame['background'])
draw = ImageDraw.Draw(im)
for cell in frame['cells']:
    x, y = pad + cell['x'] * cell_w, pad + cell['y'] * cell_h
    draw.rectangle((x, y, x + cell_w - 1, y + cell_h - 1), fill=cell['bg'])
glyphs = {}
for cell in frame['cells']:
    if cell['ch'] == ' ':
        continue
    x, y = pad + cell['x'] * cell_w, pad + cell['y'] * cell_h
    color = cell['fg']
    if cell['dim']:
        a, b = bytes.fromhex(color[1:]), bytes.fromhex(cell['bg'][1:])
        color = tuple(round(v * .6 + w * .4) for v, w in zip(a, b))
    key = (cell['ch'], cell['bold'])
    if key not in glyphs:
        mask = Image.new('L', (cell_w, cell_h))
        painter = ImageDraw.Draw(mask)
        ch = cell['ch']
        # Terminals draw box characters across the complete cell, with no gaps.
        if ch in '─│╭╮╰╯':
            cx, cy = cell_w // 2, cell_h // 2
            if ch == '─': painter.line((0, cy, cell_w, cy), fill=255, width=2)
            elif ch == '│': painter.line((cx, 0, cx, cell_h), fill=255, width=2)
            else:
                right, down = ch in '╭╰', ch in '╭╮'
                painter.line((cx, cy, cell_w if right else 0, cy), fill=255, width=2)
                painter.line((cx, cy, cx, cell_h if down else 0), fill=255, width=2)
        else:
            weight = 'Bold' if cell['bold'] else 'Regular'
            font = fonts[weight]
            if bytes(font.getmask(ch)) == missing[weight]: font = fallback
            painter.text(((cell_w - font.getlength(ch)) / 2, 34), ch, font=font, fill=255, anchor='ls')
        glyphs[key] = mask
    im.paste(color, (x, y, x + cell_w, y + cell_h), glyphs[key])
buf = io.BytesIO()
im.save(buf, format='PNG')
output = Path(sys.argv[1])
output.with_suffix('.png').write_bytes(buf.getvalue())
encoded = base64.b64encode(buf.getvalue()).decode()
output.with_suffix('.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="{width // 2}" height="{height // 2}" viewBox="0 0 {width} {height}"><image width="{width}" height="{height}" href="data:image/png;base64,{encoded}"/></svg>\n')
