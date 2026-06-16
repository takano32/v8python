# complex numbers

print(1j, 2j, 3.5j)
print(1 + 2j, 3 - 4j)
print(repr(complex(1, 2)), repr(complex(0, 2)), repr(complex(1, -2)), repr(complex(0, 0)))

# arithmetic
print((1 + 2j) + (3 + 4j))
print((1 + 2j) * (3 + 4j))
print((1 + 2j) / (1 - 1j))
print((2 + 0j) ** 2)
print((1j) ** 2)

# constructors
print(complex(3, 4), complex(5), complex("1+2j"), complex("3j"), complex("-2-3j"))

# attributes & methods
z = 3 + 4j
print(z.real, z.imag, z.conjugate(), abs(z))

# equality with real numbers
print((1 + 0j) == 1, (2 + 0j) == 2.0, 1j == 1j, (1 + 1j) == 1)

# type
print(type(1j).__name__, isinstance(1j, complex))

# mixed real/complex
print(2 + 3j, 3j + 2, 2 * (1 + 1j))

# negative base fractional power -> complex
c = (-8) ** (1 / 3)
print(round(c.real, 4), round(c.imag, 4))
