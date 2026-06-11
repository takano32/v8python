def my_func():
    pass

print(my_func.__name__)

f = my_func
print(f.__name__)

# lambda name
g = lambda x: x
print(g.__name__)

# decorated function name (wrapper's name without functools.wraps)
def deco(fn):
    def wrapper(*a, **k):
        return fn(*a, **k)
    return wrapper

@deco
def original():
    return 1

print(original.__name__)

# nested function name
def outer():
    def inner():
        pass
    return inner

print(outer().__name__)

# builtin-ish: name of a function passed around
def apply(fn, x):
    print(fn.__name__)
    return fn(x)

print(apply(abs, -5))
