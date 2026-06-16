# match / case structural pattern matching

def describe(x):
    match x:
        case 0:
            return "zero"
        case 1 | 2 | 3:
            return "small"
        case int(n) if n > 100:
            return f"big:{n}"
        case _:
            return "other"


print(describe(0), describe(2), describe(200), describe(50))

# sequence patterns
match [1, 2, 3, 4]:
    case [first, *rest]:
        print(first, rest)

match (1, 2):
    case (a, b):
        print(a + b)

# mapping patterns
config = {"host": "localhost", "port": 8080, "debug": True}
match config:
    case {"host": h, "port": p, **rest}:
        print(h, p, sorted(rest.items()))

# class patterns with namedtuple
from collections import namedtuple
Point = namedtuple("Point", "x y")
match Point(3, 4):
    case Point(x=0, y=0):
        print("origin")
    case Point(x=a, y=b):
        print("point", a, b)

# capture + as + nested
match {"line": [(0, 0), (3, 4)]}:
    case {"line": [start, (ex, ey)] as pts}:
        print(start, ex, ey, len(pts))

# match is still usable as an identifier
match = 5
print(match + 1)
