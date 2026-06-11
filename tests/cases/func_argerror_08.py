def f(a, b, c=3):
    return a + b + c

# too few positional arguments
try:
    f(1)
except TypeError as e:
    print(type(e).__name__)

# too many positional arguments
try:
    f(1, 2, 3, 4)
except TypeError as e:
    print(type(e).__name__)

# unknown keyword argument
try:
    f(1, 2, d=5)
except TypeError as e:
    print(type(e).__name__)

# multiple values for argument
try:
    f(1, 2, a=10)
except TypeError as e:
    print(type(e).__name__)

# missing keyword-only argument
def g(a, *, b):
    return a + b

try:
    g(1)
except TypeError as e:
    print(type(e).__name__)

# keyword-only passed positionally
try:
    g(1, 2)
except TypeError as e:
    print(type(e).__name__)

print("done")
