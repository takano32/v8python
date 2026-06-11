a, b = 1, 2
print(a, b)

a, b, c = [10, 20, 30]
print(a, b, c)

a, *b, c = range(5)
print(a, b, c)

*a, b = [1, 2, 3, 4]
print(a, b)

a, *b = "xyz"
print(a, b)

x, y = 1, 2
x, y = y, x
print(x, y)

first, second = [(1, 2), (3, 4)]
print(first, second)

(a, b), c = (1, 2), 3
print(a, b, c)
