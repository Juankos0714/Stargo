"""Genera static/sonidos/notificacion.wav — campana ding-dong (agradable pero fuerte).

Síntesis aditiva con stdlib (`wave` + `math`), sin dependencias:

  - Dos notas de campana: Mi5 (659.26 Hz) y La5 (880 Hz), un intervalo de
    cuarta justa arriba (el clásico «ding-dong» de campanas de iglesia).
  - Timbre de campana: fundamental + parciales inharmónicas (2.0×, 2.76×, 4.9×)
    con decaimiento exponencial — las parciales agudas se apagan antes que la
    fundamental, como una campana real.
  - Ataque rápido (~3 ms) para que suene FUERTE y presente, sin clic.
  - Normalización al 92 % del pico: fuerte pero sin recorte.
  - 22.05 kHz: las parciales más agudas (≈4.3 kHz) caben de sobra en el nuevo
    Nyquist (11 kHz), sin pérdida audible, y el WAV pesa la mitad
    (≈69 KB) para el precache de la PWA.

Uso: python scripts/generar_sonido_notificacion.py [ruta_salida]

Las constantes NOTAS/PARTIALES/ATAQUE/DURACION/PICO se espejan en
src/lib/sonido.ts (campana de Web Audio) y se verifican con
`npx vitest run tests/sonido.test.ts`. Si cambias el sonido aquí,
actualiza también ese módulo — el test fallará avisándote.
"""
import math
import sys
import wave
from pathlib import Path

SR = 22050                     # Hz, mono 16-bit PCM (la mitad de peso; las parciales máximas ≈4.3 kHz caben en el Nyquist de 11 kHz)
NOTAS: list[tuple[float, float]] = [
    (659.26, 0.0),   # Mi5 — «ding»
    (880.0, 0.30),   # La5 — «dong»
]
# (multiplicador de la fundamental, amplitud, constante de decaimiento en s)
PARTIALES: list[tuple[float, float, float]] = [
    (1.0, 1.00, 0.55),   # fundamental: la más larga y presente
    (2.0, 0.50, 0.28),   # octava: cuerpo brillante
    (2.76, 0.22, 0.15),  # parcial de campana (tercera menor)
    (4.9, 0.07, 0.08),   # brillo metálico, muy corto
]
ATAQUE = 0.003   # segundos de rampa de entrada (evita el clic y da golpe)
DURACION = 1.6   # segundos totales (colas de la campana incluidas)
PICO = 0.92      # normalización: fuerte pero sin recorte
FADE = 0.025     # fade final para cortar sin clic


def campana(t: float) -> float:
    """Muestra en `t` de las dos campanas (ding-dong)."""
    valor = 0.0
    for f, t0 in NOTAS:
        dt = t - t0
        if dt < 0:
            continue
        # Ataque lineal rápido; después, solo decaimiento exponencial.
        ataque = min(1.0, dt / ATAQUE)
        for mult, amp, tau in PARTIALES:
            decaimiento = math.exp(-dt / tau)
            valor += amp * ataque * decaimiento * math.sin(2 * math.pi * f * mult * t)
    return valor


def main() -> None:
    salida = Path(sys.argv[1]) if len(sys.argv) > 1 else (
        Path(__file__).resolve().parent.parent / 'static' / 'sonidos' / 'notificacion.wav'
    )
    salida.parent.mkdir(parents=True, exist_ok=True)

    n = int(DURACION * SR)
    muestras = [campana(i / SR) for i in range(n)]

    # Normalizar al pico objetivo (fuerte pero sin recorte).
    pico = max(abs(m) for m in muestras) or 1.0
    escala = PICO / pico
    muestras = [m * escala for m in muestras]

    # Fade final para no cortar la cola con un clic.
    fade_n = int(FADE * SR)
    for i in range(1, fade_n + 1):
        muestras[-i] *= i / fade_n

    datos = bytearray()
    for m in muestras:
        v = int(max(-1.0, min(1.0, m)) * 32767)
        datos += v.to_bytes(2, 'little', signed=True)

    with wave.open(str(salida), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(bytes(datos))

    print(f'  [OK] {salida.name}  {salida.stat().st_size / 1024:.1f} KB, '
          f'{DURACION:.2f} s, mono {SR} Hz, 16-bit (pico {PICO:.0%})')


if __name__ == '__main__':
    main()
