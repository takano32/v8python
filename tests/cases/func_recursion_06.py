def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)

print([fib(i) for i in range(10)])

def fact(n):
    if n <= 1:
        return 1
    return n * fact(n - 1)

print(fact(10))

# mutual recursion
def is_even(n):
    if n == 0:
        return True
    return is_odd(n - 1)

def is_odd(n):
    if n == 0:
        return False
    return is_even(n - 1)

print(is_even(10), is_odd(10))
print(is_even(7), is_odd(7))

# memoization with closure dict
def memo_fib():
    cache = {}
    def f(n):
        if n in cache:
            return cache[n]
        if n < 2:
            r = n
        else:
            r = f(n - 1) + f(n - 2)
        cache[n] = r
        return r
    return f

mf = memo_fib()
print(mf(30))
print([mf(i) for i in range(10)])
