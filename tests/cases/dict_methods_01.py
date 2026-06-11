d = {"a": 1, "b": 2}
print(d.pop("a"), d)
print(d.pop("z", -1))
d2 = {"x": 10, "y": 20, "z": 30}
print(d2.popitem(), d2)
d3 = {}
print(d3.setdefault("k", 5), d3)
print(d3.setdefault("k", 99), d3)
d4 = {"a": 1}
d4.update({"b": 2, "a": 100})
print(d4)
d4.update([("c", 3), ("d", 4)])
print(d4)
d4.update(e=5, f=6)
print(d4)
print(dict.fromkeys(["x", "y", "z"]))
print(dict.fromkeys([1, 2], 0))
try:
    d4["nope"]
except KeyError as e:
    print(type(e).__name__)
try:
    {}.pop("missing")
except KeyError as e:
    print(type(e).__name__)
