l = [1, 2, 3]
print(l * 2)
print(2 * l)
print(l + l)
print(l + [4, 5])
print([] * 5)
print([0] * 3)

a = [1, 2]
b = a
a += [3]
print(a)
print(b)
print(a is b)

x = [1, 2]
y = x + [3]
print(x)
print(y)
print(x is y)

a = b = [1]
a += [2]
print(a)
print(b)

c = [1]
d = c
c = c + [2]
print(c)
print(d)
