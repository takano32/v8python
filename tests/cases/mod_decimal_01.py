from decimal import Decimal as D

# exact decimal arithmetic (no binary float error)
print(D("0.1") + D("0.2"))
print(D("0.1") + D("0.2") == D("0.3"))

# trailing zeros preserved per the spec
print(D("1.0") + D("2.00"))
print(D("3.0") - D("1.0"))

# multiplication
print(D("1.5") * D("2"))
print(D("0.1") * D("0.1"))

# division
print(D("10") / D("4"))
print(D("1") / D("8"))
print(D("1") / D("3"))
print(D("2") / D("3"))

# comparison
print(D("1.5") < D("1.6"), D("2.0") == D("2"))

# construction
print(D(10), D(-5), D("0"))
print(repr(D("3.14")))

# scientific notation
print(D("1.23E+10"), D("1.5E-8"))

# unary, conversions
print(-D("3.5"), abs(D("-2.7")))
print(float(D("1.5")), int(D("7.9")))

# mixed with int
print(D("5") + 3, D("10") / 2)

# quantize
print(D("3.14159").quantize(D("0.01")))
print(D("2.5").quantize(D("1")))
