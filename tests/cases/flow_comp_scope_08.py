# comprehension loop variable must NOT leak into enclosing scope
result = [i for i in range(3)]
print(result)
try:
    print(i)
except NameError:
    print("i not defined")

# same for dict/set/gen comps
d = {k: k for k in range(2)}
try:
    print(k)
except NameError:
    print("k not defined")

# outer variable not shadowed permanently
x = "outer"
sq = [x * 2 for x in range(3)]
print(sq, x)

# pass and semicolons / compound statements
a = 1; b = 2; c = a + b
print(a, b, c)
for _ in range(2): pass
if True: x = 10; y = 20
print(x, y)
