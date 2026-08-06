"""QA del trazado: rasteriza los SVG con Chrome headless y compara cobertura
contra la silueta fuente. Diferencias grandes => trazado deformado."""
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / 'static' / 'brand'
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
TMP = Path('/tmp') / 'marca'

sys.path.insert(0, str(ROOT / 'scripts'))
from generar_marca import SRC, extraer, silueta

FUENTES = {
    'stargo-mark-blue.svg': ('LogoNegativo.webp', (255, 255, 255)),
    'stargo-mark-white.svg': ('LogoEstandar.webp', (0, 99, 254)),
    'stargo-full-blue.svg': ('MarcaNegativo.webp', (255, 255, 255)),
    'stargo-full-white.svg': ('MarcaEstandar.webp', (0, 99, 254)),
}

for svg_name, (fuente, bg) in FUENTES.items():
    svg = BRAND / svg_name
    # tamaño nativo del SVG
    xml = svg.read_text(encoding='utf-8')
    import re
    m = re.search(r'width="(\d+)" height="(\d+)"', xml)
    w, h = int(m.group(1)), int(m.group(2))

    png = TMP / (svg_name.replace('.svg', '-render.png'))
    url = (BRAND / svg_name).as_uri()
    r = subprocess.run(
        [CHROME, '--headless', '--disable-gpu', '--screenshot=' + str(png),
         '--window-size=%d,%d' % (w, h), '--hide-scrollbars', url],
        capture_output=True, text=True, timeout=60
    )
    if not png.exists():
        print(f'FALLO render de {svg_name}: {r.stderr[:200]}')
        continue

    # Chrome headless renderiza sobre fondo blanco opaco: medimos cobertura de
    # píxeles NO blancos (el color del símbolo) en RGB.
    img = Image.open(png).convert('RGB')
    arr = np.asarray(img, dtype=np.int16)
    no_blanco = (np.max(np.abs(arr - 255), axis=2) > 8)  # #F5F5F5 difiere 10 de #FFF
    cov_svg = no_blanco.mean() * 100

    # cobertura de la silueta fuente (recortada igual que en la generación)
    rgba = extraer(SRC / fuente, bg, (0, 0, 0))
    sil = silueta(rgba)
    arr = np.asarray(sil.convert('L'))
    cov_fuente = (arr < 128).mean() * 100

    print(f'{svg_name:24s} SVG={w}x{h}  cobertura fuente={cov_fuente:5.1f}%  SVG={cov_svg:5.1f}%')
