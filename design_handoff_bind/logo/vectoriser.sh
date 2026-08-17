#!/bin/sh
# Régénère les deux SVG depuis le PNG de la fondatrice.
# Voir README.md pour ce que chaque étape garantit.
set -e
cd "$(dirname "$0")"
python3 - <<'PY'
import numpy as np
from PIL import Image
a = np.array(Image.open('LOGO-BIND-source.png').convert('RGBA'))
alpha, rgb = a[..., 3], a[..., :3].astype(int)
encre = alpha > 128
orange = encre & (rgb[..., 0] > 150) & (rgb[..., 2] < 120)
COUPE = 760  # entre le mot (jusqu'à 708) et la signature (à partir de 813)
for nom, m in (('noir', (encre & ~orange)[:COUPE]), ('orange', orange[:COUPE])):
    h, w = m.shape
    with open(f'masque-{nom}.pbm', 'wb') as f:
        f.write(f'P4\n{w} {h}\n'.encode())
        f.write(np.packbits(m.astype(np.uint8), axis=1).tobytes())
PY
# Sans `--tight` : les deux traces doivent partager la même toile pour s'aligner.
for m in noir orange; do
  potrace masque-$m.pbm -b svg -o trace-$m.svg -a 1.0 -O 0.15 -u 10 -t 2
done
echo "traces régénérées — assembler avec le script de la PR, puis remesurer"
