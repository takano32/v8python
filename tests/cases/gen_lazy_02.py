# lazy evaluation: track execution timing with print
def gen():
    print("start")
    yield 1
    print("after first yield")
    yield 2
    print("after second yield")
    yield 3
    print("done")

g = gen()
print("created")          # nothing from gen yet
print(next(g))            # prints "start" then 1
print("between")
print(next(g))            # prints "after first yield" then 2
print(next(g))            # prints "after second yield" then 3
try:
    next(g)               # prints "done" then raises
except StopIteration:
    print("StopIteration")
