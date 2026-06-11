d = {}
d["c"] = 1
d["a"] = 2
d["b"] = 3
print(list(d))
d["a"] = 99
print(list(d))
print(d)
del d["a"]
d["a"] = 7
print(list(d))
print(d)
e = {"x": 1, "y": 2, "z": 3}
del e["y"]
e["y"] = 20
print(list(e.items()))
