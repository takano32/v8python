# f-string basics: plain, conversions, simple field
x = 42
name = "alice"
pi = 3.14159
print(f"{x}")
print(f"{name!r}")
print(f"{name!s}")
print(f"{pi!r}")
print(f"value={x} name={name}")
print(f"{pi:.2f}")
print(f"{x:10}")
print(f"{name:10}")
print(f"[{x:<10}]")
print(f"[{x:>10}]")
print(f"[{x:^10}]")
print(f"[{name:<10}]")
print(f"[{name:>10}]")
print(f"[{name:^10}]")
print(f"{{literal braces}} {x}")
