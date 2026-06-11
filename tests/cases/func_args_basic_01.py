def greet(name, greeting="Hi", punct="!"):
    return greeting + ", " + name + punct

print(greet("Ann"))
print(greet("Bob", "Hello"))
print(greet("Cara", punct="?"))
print(greet(name="Dan", greeting="Yo", punct="."))
print(greet("Eve", punct="!!", greeting="Hey"))

# default argument evaluated once at def time (shared mutable)
def append_to(x, lst=[]):
    lst.append(x)
    return lst

print(append_to(1))
print(append_to(2))
print(append_to(3, []))
print(append_to(4))

# safe default pattern
def append_safe(x, lst=None):
    if lst is None:
        lst = []
    lst.append(x)
    return lst

print(append_safe(1))
print(append_safe(2))
