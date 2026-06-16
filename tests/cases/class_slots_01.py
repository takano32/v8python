# __slots__ restricts instance attributes


class Point:
    __slots__ = ("x", "y")

    def __init__(self, x, y):
        self.x = x
        self.y = y


p = Point(3, 4)
print(p.x, p.y)
p.x = 10
print(p.x)

try:
    p.z = 5
except AttributeError:
    print("z denied")


# __slots__ including __dict__ allows arbitrary attributes
class Flexible:
    __slots__ = ("__dict__", "a")


f = Flexible()
f.a = 1
f.b = 2
print(f.a, f.b)


# slots accumulate across inheritance
class Base:
    __slots__ = ("base",)


class Derived(Base):
    __slots__ = ("derived",)


d = Derived()
d.base = 1
d.derived = 2
print(d.base, d.derived)
try:
    d.extra = 3
except AttributeError:
    print("extra denied")


# a non-slots subclass gains a __dict__
class Open(Base):
    pass


o = Open()
o.base = 1
o.anything = 99
print(o.base, o.anything)
