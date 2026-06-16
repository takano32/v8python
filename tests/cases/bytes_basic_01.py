# bytes / bytearray

print(b"hello", b"\x01\x02\xff")
print(repr(b"a\tb\nc"), repr(b'quote\x27s'))
print(b"abc"[0], b"abc"[-1])
print(b"abcdef"[1:4], b"abcdef"[::-1])
print(len(b"abc"), list(b"abc"))
print(b"ab" + b"cd", b"ab" * 3)
print(b"abc" == b"abc", b"abc" < b"abd")
print(b"bc" in b"abcd", 65 in b"ABC")

# encode / decode
print("héllo".encode())
print(b"h\xc3\xa9llo".decode())
print("abc".encode("ascii"), b"abc".decode("ascii"))

# hex
print(b"\x01\xff".hex(), bytes.fromhex("01ff"))

# methods
print(b"Hello".upper(), b"WORLD".lower())
print(b"a,b,c".split(b","), b"-".join([b"x", b"y"]))
print(b"hello".startswith(b"he"), b"hello".replace(b"l", b"L"))

# constructors
print(bytes(3), bytes([65, 66, 67]), bytes("hi", "ascii"))

# bytearray mutation
ba = bytearray(b"abc")
ba.append(100)
ba[0] = 65
print(ba, bytes(ba))

# int <-> bytes
print((1024).to_bytes(2, "big"), (1024).to_bytes(2, "little"))
print(int.from_bytes(b"\x04\x00", "big"))

# hashing / sorting
print(len({b"a", b"b", b"a"}))
print(sorted([b"banana", b"apple", b"cherry"]))
print(type(b"").__name__, type(bytearray()).__name__, isinstance(b"", bytes))
