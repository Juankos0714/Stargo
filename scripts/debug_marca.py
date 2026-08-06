"""Depura la extracción: cobertura, bbox y ASCII del alpha de cada fuente."""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generar_marca import SRC, extraer

CASOS = [
    ('LogoNegativo.webp', (255, 255, 255)),
    ('LogoEstandar.webp', (0, 99, 254)),
    ('MarcaNegativo.webp', (255, 255, 255)),
    ('MarcaEstandar.webp', (0, 99, 254)),
]

for fuente, bg in CASOS:
    rgba = extraer(SRC / fuente, bg, (0, 0, 0))
    alpha = np.asarray(rgba.split()[3])
    h, w = alpha.shape
    cov = (alpha > 0).mean() * 100
    print(f'== {fuente}: {w}x{h}  cobertura={cov:.1f}%  bbox={rgba.getbbox()}')

    # ASCII: 64 de ancho
    ah = max(1, int(w / 64))
    small = alpha[::ah, :: (w // 64)] > 0
    print('   ' + '-' * small.shape[1])
    for row in small:
        print('   ' + ''.join('#' if v else '.' for v in row))
    print()
