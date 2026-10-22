"""Independent PDF acceptance: Unicode text, boxes, embedded fonts and pixels."""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from pypdf import PdfReader
from PIL import Image, ImageChops, ImageStat

sys.stdout.reconfigure(encoding="utf-8")
spec = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
output = Path(spec["output"])
reader = PdfReader(spec["main"])
assert len(reader.pages) == len(spec["slides"]), "Wrong PDF page count"
normalize = lambda value: re.sub(r"\s+", "", value)
color_matches = lambda actual, expected: all(abs(a - b) <= 1 for a, b in zip(actual, expected))
summary = {"pages": [], "variants": []}

def font_records(page):
    result = []
    for ref in (page.get("/Resources").get("/Font") or {}).values():
        font = ref.get_object()
        for descendant in font.get("/DescendantFonts", [font]):
            descendant = descendant.get_object()
            descriptor = descendant.get("/FontDescriptor")
            assert descriptor, "Font descriptor missing"
            descriptor = descriptor.get_object()
            name = str(descriptor.get("/FontName"))
            embedded = [descriptor.get(key) for key in ["/FontFile", "/FontFile2", "/FontFile3"] if descriptor.get(key)]
            assert embedded and all(ref.get_object().get_data() for ref in embedded), f"Font not embedded: {name}"
            result.append(name)
    return result

def rasterize(file, stem):
    tool = shutil.which("pdftoppm")
    if tool:
        subprocess.run([tool, "-r", "96", "-png", str(file), str(output / stem)], check=True, capture_output=True)
        summary["rasterizer"] = "poppler"
    else:
        import fitz
        document = fitz.open(file)
        for index, page in enumerate(document):
            page.get_pixmap(matrix=fitz.Matrix(96 / 72, 96 / 72), alpha=False).save(output / f"{stem}-{index+1}.png")
        summary["rasterizer"] = "pymupdf"
    return sorted(output.glob(stem + "-*.png"))

images = rasterize(spec["main"], "pdf-page")
assert len(images) == len(spec["slides"])
for index, (page, slide, image_path) in enumerate(zip(reader.pages, spec["slides"], images)):
    text = page.extract_text()
    assert "\ufffd" not in text and text.strip(), "Empty or damaged PDF text"
    for expected in slide["text"]:
        assert normalize(expected) in normalize(text), (index, expected, text)
    width, height = float(page.mediabox.width), float(page.mediabox.height)
    assert abs(width - slide["width"] * .75) < .8 and abs(height - slide["height"] * .75) < .8
    names = font_records(page)
    assert names and all(spec["expectedFont"] in name for name in names), names
    image = Image.open(image_path).convert("RGB")
    assert image.size == (slide["width"], slide["height"]), image.size
    source = Image.open(slide["png"]).convert("RGB").resize(image.size, Image.Resampling.LANCZOS)
    mean = sum(ImageStat.Stat(ImageChops.difference(image, source)).mean) / 3
    assert mean < 10, f"PDF/screen raster difference too large: {mean}"
    assert color_matches(image.getpixel((10,10)), (244,241,233)), "Unexpected screen background or page margin"
    summary["pages"].append({"slideId": slide["id"], "widthPt": width, "heightPt": height, "textVerified": True, "fonts": names, "meanPixelDifference": round(mean, 4), "image": str(image_path)})

for index, variant in enumerate(spec["variants"]):
    pdf = PdfReader(variant["file"])
    assert len(pdf.pages) == 1
    for expected in spec["slides"][0]["text"]:
        assert normalize(expected) in normalize(pdf.pages[0].extract_text())
    font_records(pdf.pages[0])
    image = Image.open(rasterize(variant["file"], f"print-{index}")[0]).convert("RGB")
    expected = (226,237,243) if variant["background"] else (255,255,255)
    assert color_matches(image.getpixel((10,10)), expected), (variant, image.getpixel((10,10)))
    summary["variants"].append({"media": "print", "background": variant["background"], "pixel": list(expected)})

(output / "pdf-verification.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(summary, ensure_ascii=False))
