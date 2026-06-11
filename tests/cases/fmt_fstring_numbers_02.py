# f-string numeric format specs
n = 255
f = 3.14159
big = 1234567
neg = -42
print(f"{f:08.3f}")
print(f"{n:+d}")
print(f"{neg:+d}")
print(f"{big:,}")
print(f"{big:_}")
print(f"{n:#x}")
print(f"{n:#X}")
print(f"{n:x}")
print(f"{n:o}")
print(f"{n:#o}")
print(f"{n:b}")
print(f"{n:#b}")
print(f"{f:e}")
print(f"{f:E}")
print(f"{f:.3g}")
print(f"{12345.678:.3g}")
print(f"{0.25:%}")
print(f"{0.5:.1%}")
print(f"{1000000:,.2f}")
print(f"{n:+,}")
print(f"{neg:08d}")
print(f"{n: d}")
