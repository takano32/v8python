def make_counter():
    count = 0
    def inc():
        nonlocal count
        count += 1
        return count
    return inc

c1 = make_counter()
c2 = make_counter()
print(c1(), c1(), c1())
print(c2())
print(c1())

# function returning function (multiplier)
def multiplier(n):
    def mul(x):
        return x * n
    return mul

double = multiplier(2)
triple = multiplier(3)
print(double(5), triple(5))

# global
counter = 0
def bump():
    global counter
    counter += 1

bump()
bump()
bump()
print(counter)

# closures capturing loop variable via default arg
funcs = []
for i in range(3):
    funcs.append(lambda i=i: i * i)
print([f() for f in funcs])
