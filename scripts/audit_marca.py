"""Audita los 6 archivos de marca: muestrea fondo (esquina) y contenido (centro + puntos)."""
import sys
from PIL import Image

FILES = {
    'LogoAlt': 'docs/marca/LogoAlt.webp',
    'LogoEstandar': 'docs/marca/LogoEstandar.webp',
    'LogoNegativo': 'docs/marca/LogoNegativo.webp',
    'MarcaAlt': 'docs/marca/MarcaAlt.webp',
    'MarcaEstandar': 'docs/marca/MarcaEstandar.webp',
    'MarcaNegativo': 'docs/marca/MarcaNegativo.webp',
}

def avg(img, cx, cy, r=3):
    px = img.convert('RGB')
    w, h = px.size
    vals = []
    for dx in range(-r, r + 1):
        for dy in range(-r, r + 1):
            x, y = min(max(cx + dx, 0), w - 1), min(max(cy + dy, 0), h - 1)
            vals.append(px.getpixel((x, y)))
    n = len(vals)
    return tuple(sum(c[i] for c in vals) // n for i in range(3))

for name, path in FILES.items():
    img = Image.open(path)
    w, h = img.size
    # esquinas = fondo
    bg = avg(img, 8, 8)
    # centro y cruces = contenido (símbolo/texto)
    c1 = avg(img, w // 2, h // 2)
    c2 = avg(img, w // 2, h // 3)
    c3 = avg(img, w // 2, int(h * 0.7))
    print(f'{name:14s} {w}x{h}  fondo={bg}  c_centro={c1}  c_1/3={c2}  c_0.7={c3}')

try:
    import numpy
    print('NUMPY OK', numpy.__version__)
except ImportError:
    print('NUMPY: no')
