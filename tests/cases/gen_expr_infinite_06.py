# generator expressions and infinite generator + break
print(sum(x * x for x in range(10)))
print(sorted({c for c in "mississippi"}))
print(list(x for x in range(5) if x % 2 == 0))

# nested generator expression
print(sum(x + y for x in range(3) for y in range(3)))

# infinite generator + break to escape
def naturals():
    n = 0
    while True:
        yield n
        n += 1

out = []
for v in naturals():
    if v >= 5:
        break
    out.append(v)
print(out)

# infinite generator consumed via next a fixed number of times
g = naturals()
print([next(g) for _ in range(4)])

# genexpr passed to a function
print(max(len(w) for w in ["a", "abc", "ab"]))
