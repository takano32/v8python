def collect(*args, **kwargs):
    print(args)
    print(sorted(kwargs.items()))

collect(1, 2, 3)
collect(a=1, b=2)
collect(1, 2, x=10, y=20)

def total(first, *rest):
    return first + sum(rest)

print(total(1))
print(total(1, 2, 3, 4))

# unpacking into call
lst = [10, 20, 30]
dct = {"greeting": "Hi", "punct": "?"}

def greet(name, greeting="Hi", punct="!"):
    return greeting + ", " + name + punct

def add3(a, b, c):
    return a + b + c

print(add3(*lst))
print(greet("Zoe", **dct))
print(greet(*["Yan"], **{"greeting": "Hey"}))

# keyword-only arguments
def make(a, *, b, c=5):
    return (a, b, c)

print(make(1, b=2))
print(make(1, b=2, c=3))
print(make(a=1, b=2))
