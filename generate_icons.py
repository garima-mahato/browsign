#!/usr/bin/env python3
"""Generate simple icon PNGs for the Chrome extension."""
import struct, zlib, os

os.makedirs('icons', exist_ok=True)

def make_png(size, bg, fg):
    """Create a simple PNG with a pen/sign icon."""
    img = []
    for y in range(size):
        row = []
        for x in range(size):
            cx, cy = size // 2, size // 2
            r = size // 2 - 1
            # Circle background
            dist = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if dist <= r:
                # Draw a simple pen symbol
                rx = (x - cx) / (size * 0.25)
                ry = (y - cy) / (size * 0.25)
                # Diagonal pen stroke
                on_pen = abs(rx + ry) < 0.35 and -1.2 < rx < 1.2
                # Pen tip
                on_tip = rx > 0.7 and ry > 0.7 and (rx + ry) < 1.8
                if on_pen or on_tip:
                    row.extend(fg)
                else:
                    row.extend(bg)
            else:
                row.extend([0, 0, 0, 0])  # transparent
        img.append(bytes(row))

    # Build PNG
    def chunk(name, data):
        c = name + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    raw = b''.join(b'\x00' + row for row in img)
    idat = zlib.compress(raw)
    return (
        b'\x89PNG\r\n\x1a\n' +
        chunk(b'IHDR', ihdr) +
        chunk(b'IDAT', idat) +
        chunk(b'IEND', b'')
    )

# Amber color
bg = [212, 130, 10, 255]
fg = [250, 247, 242, 255]

for size in [16, 48, 128]:
    data = make_png(size, bg, fg)
    with open(f'icons/icon{size}.png', 'wb') as f:
        f.write(data)
    print(f'Created icons/icon{size}.png ({len(data)} bytes)')

print('Done.')
