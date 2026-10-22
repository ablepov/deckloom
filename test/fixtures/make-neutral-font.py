"""Rebuild neutral.ttf with fontTools. Original test geometry, no external font."""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

font = FontBuilder(1000, isTTF=True)
font.setupGlyphOrder([".notdef", "space", "A"])
font.setupCharacterMap({32: "space", 65: "A"})
glyphs = {}
for name in [".notdef", "space", "A"]:
    pen = TTGlyphPen(None)
    if name != "space":
        pen.moveTo((50, 0)); pen.lineTo((300, 750)); pen.lineTo((550, 0)); pen.closePath()
    glyphs[name] = pen.glyph()
font.setupGlyf(glyphs)
font.setupHorizontalMetrics({name: (600, 0) for name in glyphs})
font.setupHorizontalHeader(ascent=800, descent=-200)
font.setupNameTable({"familyName": "Deckloom Neutral Test", "styleName": "Regular", "uniqueFontIdentifier": "DeckloomNeutralTest1", "fullName": "Deckloom Neutral Test", "psName": "DeckloomNeutralTest"})
font.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
font.setupPost()
font.save(Path(__file__).with_name("neutral.ttf"))
