# one-shot exhaustion + Fibonacci generator
def gen():
    yield 1
    yield 2
    yield 3

g = gen()
print(list(g))     # consumes
print(list(g))     # already exhausted -> empty
print(list(g))     # still empty

# for-loop also exhausts
g2 = gen()
for _ in g2:
    pass
print([x for x in g2])  # empty

# Fibonacci generator
def fib():
    a, b = 0, 1
    while True:
        yield a
        a, b = b, a + b

f = fib()
print([next(f) for _ in range(10)])

# take first N via for + break
def take(g, n):
    out = []
    for i, v in enumerate(g):
        if i >= n:
            break
        out.append(v)
    return out

print(take(fib(), 8))
