import functools


@functools.total_ordering
class Ver:
    def __init__(self, n):
        self.n = n

    def __eq__(self, other):
        return self.n == other.n

    def __lt__(self, other):
        return self.n < other.n


print(Ver(1) < Ver(2), Ver(2) <= Ver(2), Ver(3) > Ver(2))
print(Ver(2) >= Ver(3), Ver(2) != Ver(2))
print([v.n for v in sorted([Ver(3), Ver(1), Ver(2)])])


def trace(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        return fn(*args, **kwargs)
    return wrapper


@trace
def greet(name):
    "Say hello."
    return "hi " + name


print(greet.__name__)
print(greet.__doc__)
print(greet("sam"))
print(greet.__wrapped__("bob"))
