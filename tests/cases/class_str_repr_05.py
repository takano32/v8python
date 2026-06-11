class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __str__(self):
        return f"({self.x}, {self.y})"

    def __repr__(self):
        return f"Point({self.x!r}, {self.y!r})"


p = Point(1, 2)
# print uses __str__
print(p)
print(str(p))
# repr() and container display use __repr__
print(repr(p))
print([p, Point(3, 4)])
print((p,))
# f-string with explicit conversions
print(f"{p} :: {p!r}")


class OnlyRepr:
    def __init__(self, v):
        self.v = v
    def __repr__(self):
        return f"OnlyRepr({self.v})"


# with no __str__, str() falls back to __repr__
o = OnlyRepr(7)
print(str(o), repr(o))
print(o)
print([o])
