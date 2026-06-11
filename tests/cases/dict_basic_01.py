d = {"a": 1, "b": 2, "c": 3}
print(d)
print(len(d))
print(d["a"], d["c"])
print("a" in d, "z" in d)
print(d.get("a"), d.get("z"), d.get("z", -1))
del d["b"]
print(d)
print("b" in d, len(d))
d["d"] = 4
print(d)
for k in d:
    print("key", k)
for v in d.values():
    print("val", v)
for k, v in d.items():
    print("item", k, v)
print(list(d.keys()))
print(list(d.values()))
print(list(d.items()))
