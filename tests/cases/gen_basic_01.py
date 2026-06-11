# basic yield, for-loop consumption, next() / StopIteration / next(g, default)
def count(n):
    i = 0
    while i < n:
        yield i
        i += 1

# for-loop consumption
for v in count(3):
    print(v)

# next() and StopIteration
g = count(2)
print(next(g))
print(next(g))
try:
    next(g)
except StopIteration:
    print("StopIteration")

# next(g, default)
g2 = count(1)
print(next(g2, "x"))
print(next(g2, "x"))
print(next(g2, "x"))

# list() over a generator
print(list(count(5)))
