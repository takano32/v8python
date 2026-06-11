# return value in generator; StopIteration.value, observed via yield from
def sub():
    yield 1
    yield 2
    return 99

# StopIteration.value directly
g = sub()
print(next(g))
print(next(g))
try:
    next(g)
except StopIteration as e:
    print("value", e.value)

# captured via yield from
def parent():
    r = yield from sub()
    print("subreturn", r)
    yield 3

p = parent()
print(list(p))

# generator with no explicit return -> value None
def plain():
    yield 1

pg = plain()
next(pg)
try:
    next(pg)
except StopIteration as e:
    print("plainvalue", e.value)
