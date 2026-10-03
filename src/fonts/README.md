# Fonts

`archivo-latin.woff2` and `archivo-latin-ext.woff2` are Archivo (SIL Open Font
License, see `OFL.txt`), self-hosted so the first visit doesn't wait on two extra
connections to Google Fonts. They are the variable `wdth` files from
`@fontsource-variable/archivo`, trimmed to the axis ranges the design uses
(width 100–115%, weight 400–850) and a smaller set of OpenType features. That
takes the latin file from 88 KB to 53 KB with no visible change.

If the CSS starts using a width above 115% or a weight outside 400–850, regenerate
with a wider range (and update the `@font-face` rules at the top of
`src/styles.css`):

```sh
npm i --no-save @fontsource-variable/archivo
pip install fonttools brotli
python3 - <<'PY'
import io
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset
src = 'node_modules/@fontsource-variable/archivo/files/archivo-{}-wdth-normal.woff2'
for sub in ['latin', 'latin-ext']:
    f = instancer.instantiateVariableFont(TTFont(src.format(sub)), {'wdth': (100, 115), 'wght': (400, 850)})
    b = io.BytesIO(); f.flavor = None; f.save(b); f = TTFont(io.BytesIO(b.getvalue()))
    o = subset.Options()
    o.layout_features = ['kern', 'liga', 'tnum', 'mark', 'mkmk', 'ccmp', 'locl', 'rvrn']
    o.name_IDs = ['*']; o.notdef_outline = True; o.hinting = False; o.glyph_names = False
    s = subset.Subsetter(o); s.populate(unicodes=list(f.getBestCmap())); s.subset(f)
    f.flavor = 'woff2'; f.save(f'src/fonts/archivo-{sub}.woff2')
PY
```
