#!/usr/bin/env python3
"""Reproduce the tested T040H1 image for COLMI R10 hardware RY03CR_V1.0."""

import argparse
from hashlib import sha256
from pathlib import Path

STOCK_PATH = (
    Path(__file__).resolve().parents[1]
    / "firmware/images/RY03CR_1.00.06_241212.bin"
)
STOCK_HASH = "1633f8e8581af209bae949c4b4b1c19b3511de3606e8785e765629054dce2c62"
BUILD_HASH = "88546e22ad72aeefb87028ab9b8fba99e60e32e8a7a1ea7f507179d45d274c39"


def application_digest(image):
    app = image[0x50:]
    return sha256(app[0x0C:0x174] + app[0x194:0x2F0] + app[0x3F0:]).digest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="Path for the new image")
    parser.add_argument("--stock", type=Path, default=STOCK_PATH, help="Exact R10 stock image downloaded from the vendor")
    args = parser.parse_args()

    stock = args.stock.read_bytes()
    if sha256(stock).hexdigest() != STOCK_HASH:
        parser.error("Stock image SHA-256 does not match the tested base")
    if application_digest(stock) != stock[0x1C4:0x1E4]:
        parser.error("Stock application digest does not match its inner header")

    image = bytearray(stock)
    # Use 40 ms in place of the stock 125 << 3 interval.
    image[0x1E0E:0x1E14] = bytes.fromhex("28 22 01 23 00 BF")
    for offset in (0x1F, 0x1CF8, 0x6137):
        image[offset:offset + 6] = b"T040H1"
    image[0x1C4:0x1E4] = application_digest(image)
    image[0x0C:0x10] = sum(image[0x50:]).to_bytes(4, "little")

    digest = sha256(image).hexdigest()
    if digest != BUILD_HASH:
        parser.error("Result differs from the hardware-tested image")
    try:
        with args.output.open("xb") as destination:
            destination.write(image)
    except FileExistsError:
        parser.error(f"Output already exists: {args.output}")
    print(f"{digest}  {args.output}")


if __name__ == "__main__":
    main()
