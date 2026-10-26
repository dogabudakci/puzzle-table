"""Pictures for the tests, laid out like real JPEGs (which the server checks), filled with noise."""
import os


def jpeg(size=3000, width=64, height=48):
    soi, eoi = b"\xff\xd8", b"\xff\xd9"
    app0 = b"\xff\xe0" + (16).to_bytes(2, "big") + b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    sof0 = b"\xff\xc0" + (11).to_bytes(2, "big") + b"\x08" + height.to_bytes(2, "big") + width.to_bytes(2, "big") + b"\x01\x01\x11\x00"
    sos = b"\xff\xda" + (8).to_bytes(2, "big") + b"\x01\x01\x00\x00\x3f\x00"
    return soi + app0 + sof0 + sos + os.urandom(size) + eoi
