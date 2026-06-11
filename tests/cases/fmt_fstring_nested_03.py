# f-string nested specs, self-doc, expressions
v = 3.14159
w = 10
p = 2
print(f"{v:{w}.{p}f}")
print(f"[{v:{w}.{p}f}]")
print(f"{v:.{p}f}")
print(f"{42:{w}d}")
x = 5
print(f"{x=}")
a = 2
b = 3
print(f"{a+b}")
print(f"{a+b=}")
d = {"k": "val", "n": 7}
print(f"{d['k']}")
print(f"{d['n']:03d}")
class Obj:
    def __init__(self):
        self.attr = "hello"
        self.num = 99
o = Obj()
print(f"{o.attr}")
print(f"{o.num:+d}")
print(f"{len(name) if (name := 'abc') else 0}")
lst = [1, 2, 3]
print(f"{lst[1]}")
print(f"{sum(lst)}")
