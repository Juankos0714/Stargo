"""Genera los SVG/PNG de marca de StarGo a partir de los swatches de docs/marca/.

Los swatches son JPEG/WebP con fondo sólido horneado. Este script:
  1. Quita el fondo sólido (color-key con numpy) → símbolo puro sobre transparente.
  2. Traza a SVG con vtracer (binario, splines) → static/brand/*.svg.
  3. Compone los íconos PNG sobre fondo de marca → static/icons/*.png.
  4. Genera la imagen OG → static/icons/og-image.png.

Uso: python scripts/generar_marca.py
Requiere: pillow, numpy, y el CLI oficial de vtracer (visioncortex) descargado
(https://github.com/visioncortex/vtracer/releases → vtracer-x86_64-pc-windows-msvc.zip).
La ruta del binario se pasa con la variable de entorno VTRACER.
"""
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'docs' / 'marca'
OUT_BRAND = ROOT / 'static' / 'brand'
OUT_ICONS = ROOT / 'static' / 'icons'
TMP = Path('/tmp') / 'marca'

# Colores de marca (verificados por muestreo de píxel sobre los originales)
BLUE = (0, 100, 255)        # stargo-blue #0064FF
NAVY = (0, 22, 33)          # stargo-navy  #001621
WHITE = (245, 245, 245)     # stargo-white #F5F5F5

# (fuente, fondo_a_quitar, color_objetivo, nombre_salida)
TAREAS_SVG = [
    # mark = solo símbolo "S"
    ('LogoNegativo.webp', (255, 255, 255), BLUE, 'stargo-mark-blue.svg'),
    ('LogoEstandar.webp', (0, 99, 254), WHITE, 'stargo-mark-white.svg'),
    # full = símbolo + wordmark "stargo"
    ('MarcaNegativo.webp', (255, 255, 255), BLUE, 'stargo-full-blue.svg'),
    ('MarcaEstandar.webp', (0, 99, 254), WHITE, 'stargo-full-white.svg'),
]

UMBRAL = 40   # distancia Chebyshev mínima para considerar "contenido"
BANDA = 18    # ancho de la banda de transición (suavizado de bordes)


def extraer(src: Path, bg: tuple, objetivo: tuple) -> Image.Image:
    """Devuelve RGBA con el símbolo en `objetivo` puro sobre transparente."""
    img = Image.open(src).convert('RGB')
    arr = np.asarray(img, dtype=np.int16)
    bg_a = np.array(bg, dtype=np.int16).reshape(1, 1, 3)
    dist = np.max(np.abs(arr - bg_a), axis=2)  # Chebyshev

    # Banda de transición suave entre (UMBRAL - BANDA) y UMBRAL
    t0, t1 = UMBRAL - BANDA, UMBRAL
    alpha = np.clip((dist - t0) * (255.0 / (t1 - t0)), 0, 255).astype(np.uint8)

    # Recolorar todo el contenido al color objetivo puro (limpia ruido de compresión)
    rgb = np.full((*arr.shape[:2], 3), objetivo, dtype=np.uint8)
    rgba = np.dstack([rgb, alpha])
    out = Image.fromarray(rgba)

    # Erosión 3x3 del alpha: elimina speckle de compresión (píxeles sueltos de 1px)
    # sin afectar los trazos gruesos del símbolo.
    out.putalpha(out.split()[3].filter(ImageFilter.MinFilter(3)))

    # Algunos swatches tienen franjas de ruido de compresión pegadas a los bordes
    # (p. ej. 797px en el borde derecho de LogoEstandar). Recortamos un margen fijo
    # del lienzo — el símbolo siempre está bien dentro del canvas (0.6% a 1280px).
    m = 8
    if out.width > 2 * m and out.height > 2 * m:
        out = out.crop((m, m, out.width - m, out.height - m))

    # Recortar al bounding box del contenido limpio
    bbox = out.getbbox()
    if bbox:
        out = out.crop(bbox)
    return out


def silueta(rgba: Image.Image) -> Image.Image:
    """Silueta negra sobre blanco (para el trazado binario de vtracer)."""
    alpha = rgba.split()[3]
    sil = Image.new('RGB', rgba.size, 'white')
    sil.paste((0, 0, 0), mask=alpha)
    return sil


# El CLI oficial de vtracer se descarga de GitHub Releases. Se localiza por la
# variable VTRACER o en el directorio temporal de Windows (evita rutas MSYS rotas).
def _hallar_vtracer() -> str:
    cand = os.environ.get('VTRACER')
    if cand and Path(cand).exists():
        return cand
    tmp = os.environ.get('TEMP') or os.environ.get('TMP') or ''
    for p in [Path(tmp) / 'vtracer' / 'vtracer.exe', Path('/tmp') / 'vtracer' / 'vtracer.exe']:
        if p.exists():
            return str(p)
    sys.exit('vtracer.exe no encontrado. Descárgalo de '
             'https://github.com/visioncortex/vtracer/releases (vtracer-x86_64-pc-windows-msvc.zip) '
             'y pásalo con VTRACER=<ruta>')

VTRACER = _hallar_vtracer()


def trazar_svg(sil: Image.Image, color: tuple, out_svg: Path):
    """Traza la silueta con vtracer (CLI oficial) y pinta el fill con el color objetivo."""
    png = TMP / 'silueta.png'
    sil.save(png)
    hexcolor = '#%02X%02X%02X' % color
    r = subprocess.run(
        [VTRACER, '-i', str(png), '-o', str(out_svg), '--preset', 'bw', '-m', 'spline', '-f', '4'],
        capture_output=True, text=True
    )
    if r.returncode != 0:
        sys.exit(f'vtracer falló: {r.stderr}')
    svg = out_svg.read_text(encoding='utf-8')
    import re
    svg = re.sub(r'fill="(?:black|#000|#000000)"', f'fill="{hexcolor}"', svg)
    svg = svg.replace('<svg ', '<svg role="img" aria-label="Stargo" ', 1)
    # viewBox explícito para escalado nítido con height fijo
    m = re.search(r'width="(\d+)" height="(\d+)"', svg)
    if m and 'viewBox' not in svg:
        svg = svg.replace(
            f'width="{m.group(1)}" height="{m.group(2)}"',
            f'width="{m.group(1)}" height="{m.group(2)}" viewBox="0 0 {m.group(1)} {m.group(2)}"',
            1
        )
    out_svg.write_text(svg, encoding='utf-8')
    print(f'  ✓ {out_svg.name}  ({out_svg.stat().st_size / 1024:.1f} KB, fill={hexcolor})')


def composar(icono: Image.Image, ancho: int, alto: int, fondo: tuple, escala=0.62):
    """Centra el icono sobre un lienzo del color de marca."""
    canvas = Image.new('RGB', (ancho, alto), fondo)
    w, h = icono.size
    s = min(ancho * escala / w, alto * escala / h)
    icono = icono.resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)
    canvas.paste(icono, ((ancho - icono.size[0]) // 2, (alto - icono.size[1]) // 2), icono)
    return canvas


def main():
    TMP.mkdir(parents=True, exist_ok=True)
    OUT_BRAND.mkdir(parents=True, exist_ok=True)
    OUT_ICONS.mkdir(parents=True, exist_ok=True)

    print('== 1. Extracción y trazado SVG ==')
    marcas = {}
    for fuente, bg, objetivo, nombre in TAREAS_SVG:
        print(f'  {fuente}  →  {nombre}  (bg={bg}, color={objetivo})')
        rgba = extraer(SRC / fuente, bg, objetivo)
        marcas[nombre] = rgba
        trazar_svg(silueta(rgba), objetivo, OUT_BRAND / nombre)

    mark_blue = marcas['stargo-mark-blue.svg']
    mark_white = marcas['stargo-mark-white.svg']

    print('== 2. Íconos de app (símbolo blanco sobre #0064FF) ==')
    iconos = [
        ('icon-1024.png', 1024, 1024, 0.62),  # maestro para app stores (spec >=1024)
        ('icon-512.png', 512, 512, 0.62),
        ('icon-192.png', 192, 192, 0.62),
        ('icon-maskable-512.png', 512, 512, 0.60),  # zona segura ~80% (central)
        ('apple-touch-icon.png', 180, 180, 0.62),
        ('favicon.png', 64, 64, 0.75),
    ]
    for nombre, w, h, escala in iconos:
        img = composar(mark_white, w, h, BLUE, escala=escala)
        img.save(OUT_ICONS / nombre, format='PNG')
        print(f'  ✓ {nombre}  {w}x{h}')

    print('== 3. Imagen OG (lockup azul sobre blanco de marca) ==')
    full_blue = marcas['stargo-full-blue.svg']
    og = composar(full_blue, 1200, 630, WHITE, escala=0.55)
    og.save(OUT_ICONS / 'og-image.png', format='PNG')
    print('  ✓ og-image.png  1200x630')

    print('== 4. Preview transparente (para QA) ==')
    for nombre, rgba in marcas.items():
        rgba.save(TMP / (nombre.replace('.svg', '-transparente.png')))
    print(f'  previews en {TMP}/')


if __name__ == '__main__':
    main()
