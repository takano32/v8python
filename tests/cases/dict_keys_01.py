d = {}
d[1] = "int"
d[1.0] = "float"
d[True] = "bool"
print(d)
print(len(d), d[1], d[1.0], d[True])
t = {}
t[(1, 2)] = "a"
t[(3, 4)] = "b"
print(t[(1, 2)], t[(3, 4)])
print((1, 2) in t, (9, 9) in t)
print(len(t))
m = {0: "zero", False: "f"}
print(m, len(m))
