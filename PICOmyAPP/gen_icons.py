from PIL import Image, ImageDraw, ImageFont

BG = (7, 17, 15, 255)          # #07110f
ACCENT = (104, 239, 179, 255)  # #68efb3
ACCENT_DARK = (8, 58, 41, 255) # #083a29

def draw_mark(size, pad_ratio):
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)
    pad = int(size * pad_ratio)
    box = [pad, pad, size - pad, size - pad]

    # rounded square backplate
    d.rounded_rectangle(box, radius=int(size*0.14), fill=ACCENT_DARK, outline=ACCENT, width=max(2, size//64))

    # simple "eye / scan" glyph: outer eye shape + pupil + corner scan brackets
    cx, cy = size // 2, size // 2
    ew, eh = int(size*0.34), int(size*0.20)
    d.ellipse([cx-ew, cy-eh, cx+ew, cy+eh], outline=ACCENT, width=max(3, size//40))
    r = int(size*0.09)
    d.ellipse([cx-r, cy-r, cx+r, cy+r], fill=ACCENT)

    # scan-corner brackets (QC framing)
    b = int(size*0.10)
    L = int(size*0.10)
    lw = max(3, size//48)
    corners = [box[0], box[1], box[2], box[3]]
    x0, y0, x1, y1 = corners
    inset = int(size*0.06)
    x0 += inset; y0 += inset; x1 -= inset; y1 -= inset
    # top-left
    d.line([(x0, y0+L), (x0, y0), (x0+L, y0)], fill=ACCENT, width=lw)
    # top-right
    d.line([(x1-L, y0), (x1, y0), (x1, y0+L)], fill=ACCENT, width=lw)
    # bottom-left
    d.line([(x0, y1-L), (x0, y1), (x0+L, y1)], fill=ACCENT, width=lw)
    # bottom-right
    d.line([(x1-L, y1), (x1, y1), (x1, y1-L)], fill=ACCENT, width=lw)

    return img

# "any" purpose icons - normal padding
for s in (192, 512):
    img = draw_mark(s, 0.06)
    img.save(f"/home/claude/repo/pico-webapp/icons/icon-{s}.png")

# "maskable" icon - needs extra safe-zone padding (content within ~80% center circle)
img = draw_mark(1024, 0.18)
img.save("/home/claude/repo/pico-webapp/icons/icon-maskable-1024.png")

print("done")
