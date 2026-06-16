import sys

# maxsize is 2**63 - 1 on 64-bit platforms (matches CPython)
print(sys.maxsize)
print(sys.maxsize == 2**63 - 1)
print(sys.maxunicode)

# maxsize behaves like a normal int
print(sys.maxsize + 1)
print(sys.maxsize.bit_length())
