sq = {x: x * x for x in range(5)}
print(sq)
filt = {k: v for k, v in sq.items() if v % 2 == 0}
print(filt)
a = {"x": 1, "y": 2}
b = {"y": 20, "z": 30}
print({**a, **b})
print(a | b)
print(b | a)
merged = a | b
print(merged, a, b)
print(dict(zip(["a", "b", "c"], [1, 2, 3])))
print(dict(zip("xy", range(2))))
shared = [1, 2]
g = {"p": shared, "q": shared}
g["p"].append(3)
print(g["p"], g["q"])
print(g["p"] is g["q"])
