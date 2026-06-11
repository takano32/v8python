# send / close / throw
def echo():
    while True:
        x = yield
        print("got", x)

g = echo()
next(g)            # prime
g.send("a")
g.send("b")
g.close()
try:
    g.send("c")
except StopIteration:
    print("closed-StopIteration")

# x = yield y pattern
def accumulator():
    total = 0
    while True:
        n = yield total
        if n is None:
            n = 0
        total += n

a = accumulator()
print(next(a))         # 0
print(a.send(10))      # 10
print(a.send(5))       # 15

# throw caught inside generator, continue
def resilient():
    while True:
        try:
            x = yield
            print("ok", x)
        except ValueError:
            print("caught ValueError")

r = resilient()
next(r)
r.send(1)
print(r.throw(ValueError))  # caught, then yields None -> prints None
r.send(2)
