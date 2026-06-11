from functools import reduce, partial, lru_cache
print(reduce(lambda a, b: a + b, [1, 2, 3, 4, 5]))
print(reduce(lambda a, b: a * b, [1, 2, 3, 4], 1))
add = lambda x, y: x + y
add5 = partial(add, 5)
print(add5(10))

calls = 0
@lru_cache(maxsize=None)
def fib(n):
    global calls
    calls += 1
    return n if n < 2 else fib(n-1) + fib(n-2)
print(fib(20))
print("calls:", calls)
