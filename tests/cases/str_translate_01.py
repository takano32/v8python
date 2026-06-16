# str.translate / str.maketrans

# two-string maketrans maps ordinals to ordinals
t = str.maketrans("abc", "xyz")
print(t)
print("aabbcc".translate(t))

# dict table with int keys -> str / None / ordinal
print("hello".translate({ord("l"): "L"}))
print("hello".translate({ord("l"): None}))
print("hi".translate({104: "H", 105: 0x49}))

# three-arg maketrans: third arg is deleted
print("banana".translate(str.maketrans("", "", "a")))

# single-dict maketrans accepts single-char string keys
print("cat".translate(str.maketrans({"c": "C", "t": None})))

# unmapped characters are kept as-is
print("xyz".translate(str.maketrans("a", "b")))
